"""Isolated Moonshine Voice 0.1.6 worker for Harbor subtitle sync.

Invoked with python -I -c, never from the playback process. Only the final
JSON line prefixed with HARBOR_MOONSHINE_RESULT is read by Rust.
"""
import importlib.util
import json
import math
import os
from pathlib import Path
import sys
import traceback

PREFIX = "HARBOR_MOONSHINE_RESULT="
LANGUAGES = {"en", "ar", "de", "es", "ja", "zh", "tl", "vi"}

def emit(value):
    print(PREFIX + json.dumps(value, ensure_ascii=True), flush=True)

def require_runtime():
    try:
        import moonshine_voice as m
    except (ImportError, OSError) as e:
        raise RuntimeError("moonshine-runtime-missing: " + str(e)) from e
    if getattr(m, "__version__", None) != "0.1.6":
        raise RuntimeError("moonshine-runtime-version-mismatch")
    return m

def manifest_path(root, language):
    return root / "models" / (language + ".json")

def read_installed(root, language):
    file = manifest_path(root, language)
    if not file.is_file():
        return None
    try:
        value = json.loads(file.read_text(encoding="utf-8"))
        path = Path(value["path"]).resolve()
        if value.get("language") != language or not path.is_dir():
            return None
        files = value.get("files", [])
        if not files or any(not (path / name).is_file() or (path / name).stat().st_size < 64 for name in files):
            return None
        if value.get("arch") != 2:
            return None
        return value
    except (OSError, ValueError, KeyError, TypeError):
        return None

def status(root, language):
    runtime = False
    try:
        require_runtime()
        runtime = True
    except Exception:
        pass
    return {"supported": True, "runtimeInstalled": runtime,
            "installed": bool(runtime and read_installed(root, language)),
            "language": language}

def download(root, language):
    m = require_runtime()
    if language not in LANGUAGES:
        raise RuntimeError("moonshine-language-unsupported")
    from moonshine_voice.download import find_model_info, _primary_stt_group
    info = find_model_info(language, m.ModelArch.TINY_STREAMING)
    files = [f["name"] for f in _primary_stt_group(info, include_word_timestamps=True)["files"]]
    path, arch = m.get_model_for_language(
        language, m.ModelArch.TINY_STREAMING,
        cache_root=root / "assets", include_word_timestamps=True,
        on_progress=lambda fraction, name: None)
    value = {"language": language, "arch": int(arch), "path": str(Path(path).resolve()), "files": files}
    marker = manifest_path(root, language)
    marker.parent.mkdir(parents=True, exist_ok=True)
    tmp = marker.with_suffix(".part")
    tmp.write_text(json.dumps(value), encoding="utf-8")
    tmp.replace(marker)
    if not read_installed(root, language):
        raise RuntimeError("moonshine-model-incomplete")
    return status(root, language)

def finite_span(start, end, length):
    try:
        start, end = float(start), float(end)
    except (TypeError, ValueError):
        return False
    return math.isfinite(start) and math.isfinite(end) and 0 <= start < end <= length + 0.5


def extract_timed_speech(lines, start, length):
    """Prefer word timestamps, but retain reliable line-level time spans.

    Some Moonshine clips return a transcript with no word alignments. The
    existing Harbor matcher accepts speech intervals, so discarding timed
    sentence/phrase lines was unnecessarily losing useful sync evidence.
    """
    tokens = []
    word_candidates = 0
    fallback_lines = 0
    for line in lines:
        valid_words = []
        for word in (line.words or []):
            word_candidates += 1
            if finite_span(word.start, word.end, length) and str(word.word).strip():
                valid_words.append({
                    "text": str(word.word),
                    "t0": start + float(word.start),
                    "t1": start + float(word.end),
                    "p": 0.0,
                })
        if valid_words:
            tokens.extend(valid_words)
            continue
        # Only use line timings when the recognized line has actual content
        # and a positive finite duration. Never invent boundaries from text.
        line_text = str(line.text or "").strip()
        begin = line.start_time
        end = float(begin) + float(line.duration) if begin is not None else None
        if line_text and finite_span(begin, end, length):
            tokens.append({
                "text": line_text,
                "t0": start + float(begin),
                "t1": start + float(end),
                "p": 0.0,
            })
            fallback_lines += 1
    return tokens, {
        "recognizedLines": len(lines),
        "wordCandidates": word_candidates,
        "wordIntervals": len(tokens) - fallback_lines,
        "lineIntervals": fallback_lines,
    }


def transcribe(root, language, job):
    m = require_runtime()
    installed = read_installed(root, language)
    if not installed:
        raise RuntimeError("moonshine-model-missing-for-language:" + language)
    from array import array
    from moonshine_voice import Transcriber
    output = []
    # No network calls during playback. All files must have been installed via settings.
    with Transcriber(installed["path"], m.ModelArch.TINY_STREAMING, options={"word_timestamps": "true"}) as engine:
        for entry in job["windows"]:
            input_path = Path(job["dir"]) / entry["file"]
            data = array("f")
            with input_path.open("rb") as stream:
                data.fromfile(stream, int(entry["samples"]))
            if sys.byteorder != "little":
                data.byteswap()
            # Diagnostics contain only audio levels and timing counts, never
            # captured audio or transcript text.
            sampled = data[::160]
            audio_rms = math.sqrt(sum(float(x) * float(x) for x in sampled) / len(sampled)) if sampled else 0.0
            audio_peak = max((abs(float(x)) for x in sampled), default=0.0)
            result = engine.transcribe_without_streaming(data, 16000)
            tokens, stats = extract_timed_speech(result.lines, entry["start"], entry["length"])
            stats["audioRms"] = round(audio_rms, 6)
            stats["audioPeak"] = round(audio_peak, 6)
            stats["chunkRetry"] = False
            if not tokens and len(data) >= 16_000 * 15:
                # A 30-35 second window can produce no alignment even when
                # shorter utterances are recognized. Retry bounded 10-second
                # chunks, retaining their positions in the original clip.
                retry_tokens = []
                retry_lines = 0
                retry_words = 0
                retry_fallbacks = 0
                for sample_start in range(0, len(data), 16000 * 10):
                    fragment = data[sample_start : sample_start + 16000 * 10]
                    if len(fragment) < 16000 * 3:
                        continue
                    fragment_result = engine.transcribe_without_streaming(fragment, 16000)
                    fragment_tokens, fragment_stats = extract_timed_speech(
                        fragment_result.lines,
                        entry["start"] + sample_start / 16000.0,
                        len(fragment) / 16000.0,
                    )
                    retry_tokens.extend(fragment_tokens)
                    retry_lines += fragment_stats["recognizedLines"]
                    retry_words += fragment_stats["wordCandidates"]
                    retry_fallbacks += fragment_stats["lineIntervals"]
                if retry_tokens:
                    tokens = retry_tokens
                stats["chunkRetry"] = True
                stats["retryRecognizedLines"] = retry_lines
                stats["retryWordCandidates"] = retry_words
                stats["retryLineIntervals"] = retry_fallbacks
                stats["retryTimedIntervals"] = len(retry_tokens)
            output.append({
                "startSec": entry["start"],
                "lenSec": entry["length"],
                "lang": language,
                "tokens": tokens,
                "stats": stats,
            })
    return output

def main():
    # argv: mode root language [job.json]. The runtime is installed into
    # app-private site packages instead of modifying the user's Python.
    mode, home, language = sys.argv[1:4]
    root = Path(home).resolve()
    # A frozen worker contains its own Python interpreter and dependencies.
    # Never let a previously installed developer runtime shadow bundled code.
    if not getattr(sys, "frozen", False):
        sys.path.insert(0, str(root / "runtime"))
    if language not in LANGUAGES:
        raise RuntimeError("moonshine-language-unsupported")
    if mode == "status":
        emit(status(root, language))
    elif mode == "download":
        emit(download(root, language))
    elif mode == "remove":
        # Release the installed model assets as well as the status marker.
        # Never delete outside Harbor's own asset cache, even if a marker was edited.
        import shutil
        installed = read_installed(root, language)
        manifest_path(root, language).unlink(missing_ok=True)
        if installed:
            model_dir = Path(installed["path"]).resolve()
            asset_root = (root / "assets").resolve()
            try:
                relative = model_dir.relative_to(asset_root)
                shared = any(
                    other != language
                    and (value := read_installed(root, other))
                    and Path(value["path"]).resolve() == model_dir
                    for other in LANGUAGES
                )
                if len(relative.parts) > 1 and not shared:
                    shutil.rmtree(model_dir)
            except ValueError:
                pass
        emit(status(root, language))
    elif mode == "transcribe":
        with open(sys.argv[4], "r", encoding="utf-8") as stream:
            job = json.load(stream)
        emit(transcribe(root, language, job))
    else:
        raise RuntimeError("moonshine-invalid-operation")

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        # Don't leak media paths or subtitle content in a diagnostic.
        code = str(e).split(":", 1)[0]
        emit({"error": code if code.startswith("moonshine-") else "moonshine-worker-failed"})
        sys.exit(1)
