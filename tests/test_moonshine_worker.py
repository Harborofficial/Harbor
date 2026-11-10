"""Focused tests for Moonshine speech interval extraction, no model download required."""
import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest

MODULE_PATH = Path(__file__).resolve().parents[1] / "src-tauri" / "src" / "subsync" / "moonshine_worker.py"
SPEC = importlib.util.spec_from_file_location("harbor_moonshine_worker", MODULE_PATH)
worker = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(worker)


def line(text, start, duration, words=None):
    return SimpleNamespace(
        text=text,
        start_time=start,
        duration=duration,
        words=words,
    )


def word(text, start, end):
    return SimpleNamespace(word=text, start=start, end=end)


class MoonshineIntervalsTest(unittest.TestCase):
    def test_prefers_valid_word_timestamps(self):
        result, stats = worker.extract_timed_speech(
            [line("hello there", 0.0, 2.0, [word("hello", 0.2, 0.6), word("there", 0.8, 1.3)])],
            5.0, 10.0)
        self.assertEqual([r["t0"] for r in result], [5.2, 5.8])
        self.assertEqual(stats["wordIntervals"], 2)
        self.assertEqual(stats["lineIntervals"], 0)

    def test_uses_line_timing_when_word_timestamps_absent(self):
        result, stats = worker.extract_timed_speech(
            [line("hello there", 1.0, 1.5)], 5.0, 10.0)
        self.assertEqual(result[0]["text"], "hello there")
        self.assertEqual((result[0]["t0"], result[0]["t1"]), (6.0, 7.5))
        self.assertEqual(stats["lineIntervals"], 1)

    def test_uses_line_timing_for_invalid_word_spans(self):
        result, stats = worker.extract_timed_speech(
            [line("test", 2.0, 1.0, [word("test", float("nan"), 3.0)])], 0.0, 10.0)
        self.assertEqual(len(result), 1)
        self.assertEqual((result[0]["t0"], result[0]["t1"]), (2.0, 3.0))
        self.assertEqual(stats["wordCandidates"], 1)
        self.assertEqual(stats["lineIntervals"], 1)

    def test_does_not_invent_timestamps_for_empty_or_invalid_lines(self):
        result, stats = worker.extract_timed_speech(
            [line("hello", 0.0, 0.0), line("", 1.0, 2.0),
             line("bad", -2.0, 1.0), line("outside", 9.5, 4.0)], 0.0, 10.0)
        self.assertEqual(result, [])
        self.assertEqual(stats["recognizedLines"], 4)
        self.assertEqual(stats["wordIntervals"], 0)
        self.assertEqual(stats["lineIntervals"], 0)


if __name__ == "__main__":
    unittest.main()
