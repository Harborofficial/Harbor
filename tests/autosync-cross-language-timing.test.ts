import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  crossLanguagePlaybackOffset,
  crossLanguageSpeechTransform,
  type Interval,
} from "../src/lib/subtitles/autosync/drift-dsp.ts";

// Timing-only excerpts from the reported English/Greek pair. No dialogue text.
const excerpts = JSON.parse(
  readFileSync(new URL("./fixtures/cross-language-timing.json", import.meta.url), "utf8"),
) as Array<{
  startSec: number;
  lenSec: number;
  expectedOffsetSec: number;
  reference: Interval[];
  translated: Interval[];
}>;

test("real translated cue grouping recovers different local delays without assuming a constant episode offset", () => {
  for (const excerpt of excerpts) {
    const result = crossLanguagePlaybackOffset(
      excerpt.reference,
      excerpt.translated,
      [excerpt],
      30,
    );
    assert.ok(result !== null && Math.abs(result - excerpt.expectedOffsetSec) <= 0.2);
  }
});

function driftFixture(ratio = 1.002, offset = 0.7) {
  const windows = [100, 800, 1600, 2400].map((startSec) => ({ startSec, lenSec: 30 }));
  const phrases: Interval[] = windows.flatMap(({ startSec }) =>
    [
      [1, 3.2],
      [6.1, 9.4],
      [13, 15.1],
      [19.2, 23.8],
      [26, 28.4],
    ].map(([a, b]) => [startSec + a, startSec + b] as Interval),
  );
  // Whisper words contain brief gaps. Translated captions split or merge those words.
  const speech: Interval[] = phrases.flatMap(([a, b]) => {
    const tokens: Interval[] = [];
    for (let t = a; t < b; t += 0.5) tokens.push([t, Math.min(t + 0.4, b)]);
    return tokens;
  });
  const cues: Interval[] = phrases.map(([a, b]) => [(a - offset) / ratio, (b - offset) / ratio]);
  return { windows, speech, cues };
}

test("word gaps and translated line grouping allow a bounded gradual timing correction in both directions", () => {
  for (const ratio of [1.002, 0.998]) {
    const { speech, cues, windows } = driftFixture(ratio);
    const result = crossLanguageSpeechTransform(speech, cues, windows, 30, 2700);
    assert.ok(result);
    assert.ok(Math.abs(result.ratio - ratio) < 0.0001);
    assert.ok(Math.abs(result.offsetSec - 0.7) < 0.15);
    assert.equal(crossLanguagePlaybackOffset(speech, cues, windows, 30), null);
  }
});

test("short coverage, abrupt changes, excessive drift and ambiguous patterns cannot establish an episode rate", () => {
  const { speech, cues, windows } = driftFixture();
  assert.equal(crossLanguageSpeechTransform(speech, cues, windows.slice(0, 3), 30, 2700), null);
  assert.equal(crossLanguageSpeechTransform(speech, cues, windows, 30, 10000), null);
  const cut: Interval[] = cues.map(([a, b]) => (a > 1000 ? [a - 8, b - 8] : [a, b]));
  assert.equal(crossLanguageSpeechTransform(speech, cut, windows, 30, 2700), null);
  const excessive = driftFixture(1.01);
  assert.equal(
    crossLanguageSpeechTransform(excessive.speech, excessive.cues, excessive.windows, 30, 2700),
    null,
  );
  const repeated = cues.flatMap(([a, b]): Interval[] => [
    [a, b],
    [a + 16, b + 16],
  ]);
  assert.equal(crossLanguageSpeechTransform(speech, repeated, windows, 30, 2700), null);
});
