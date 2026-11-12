// @ts-expect-error Node test types are outside the browser tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are outside the browser tsconfig.
import { readFileSync } from "node:fs";
// @ts-expect-error Node test types are outside the browser tsconfig.
import test from "node:test";

const source = readFileSync(new URL("../src-tauri/src/mpv.rs", import.meta.url), "utf8");
const section = source.slice(
  source.indexOf("// Windows-only, bounded high-resolution measurements"),
  source.indexOf("const MPV_EVENT_MAX_CONSECUTIVE_ERRORS"),
);
const eventLoop = source.slice(
  source.indexOf("fn spawn_event_loop("),
  source.indexOf("fn event_to_payload("),
);

test("Windows resume diagnostic stays bounded, with five-second background health", () => {
  assert.match(
    section,
    /#\[cfg\(windows\)\]\s*const RESUME_TRACE_WINDOW: Duration = Duration::from_secs\(8\)/,
  );
  assert.match(section, /RESUME_TRACE_INTERVAL: Duration = Duration::from_millis\(250\)/);
  assert.match(section, /RESUME_DETAIL_INTERVAL: Duration = Duration::from_secs\(1\)/);
  assert.match(section, /RESUME_HEALTH_INTERVAL: Duration = Duration::from_secs\(5\)/);
  assert.match(section, /if age > RESUME_TRACE_WINDOW \{/);
  assert.match(eventLoop, /resume_trace\.sample_age/);
  assert.match(eventLoop, /resume_trace\.detail_due/);
  assert.match(section, /fn trace_resume_fast_sample/);
  assert.match(eventLoop, /resume_trace\.health_due/);
});
test("only real pause to resume begins the high-resolution trace", () => {
  assert.match(section, /let paused_at = self\.paused_at\.take\(\)\?/);
  assert.match(section, /self\.active = Some\(ResumeTrace/);
  assert.match(eventLoop, /resume_trace\.on_pause_change\(\*paused, now\)/);
  assert.match(eventLoop, /resume_trace\.clear\(\)/);
  assert.match(eventLoop, /Event::EndFile\(_\) \| Event::FileLoaded \| Event::Shutdown/);
});
test("metrics use documented clocks and skip display-sync-only counter when inactive", () => {
  for (const name of [
    "avsync",
    "total-avsync-change",
    "audio-pts",
    "time-pos",
    "demuxer-cache-duration",
    "demuxer-cache-time",
    "cache-speed",
    "demuxer-cache-state/fw-bytes",
    "paused-for-cache",
    "demuxer-cache-idle",
    "seeking",
    "core-idle",
    "audio-out-params/samplerate",
    "audio-params/samplerate",
    "estimated-vf-fps",
    "display-sync-active",
    "frame-drop-count",
    "decoder-frame-drop-count",
    "mistimed-frame-count",
    "vo-delayed-frame-count",
    "hwdec-current",
  ])
    assert.ok(section.includes('"' + name + '"'), name);
  assert.ok(!section.includes('"video-pts"'), "video-pts is not an mpv property");
  assert.match(section, /snapshot\.value\("display-sync-active"\)/);
  assert.ok(section.includes("mistimed-frame-count"));
  assert.match(section, /na.*into/);
  assert.match(section, /ao=\{\} audio_hz=\{\} output_hz=\{\}/);
});
test("logs timeline transitions and marks warning distance from resume", () => {
  for (const name of ["Seek", "PlaybackRestart", "FileLoaded", "EndFile", "Shutdown"])
    assert.ok(eventLoop.includes("Event::" + name), name);
  for (const message of [
    "pause-state",
    "cache-pause-change",
    "playback-restart",
    "event-poll-delay",
    "event-error",
  ])
    assert.ok(eventLoop.includes(message), message);
  assert.match(section, /Audio device underrun detected/);
  assert.match(section, /Audio\/Video desynchronisation detected/);
  assert.match(section, /Failure when receiving data/);
  assert.match(eventLoop, /since_resume_ms=\{\} kind=\{kind\}/);
});
test("detects clock stalls only when actually playing, not paused or buffering", () => {
  assert.match(section, /RESUME_POSITION_STALL: Duration = Duration::from_secs\(3\)/);
  assert.match(section, /fn observe\(/);
  assert.match(section, /if !playing \{/);
  assert.match(eventLoop, /resume_observed\.flag\("paused-for-cache"\) == Some\(false\)/);
  assert.match(eventLoop, /resume_observed\.flag\("seeking"\) == Some\(false\)/);
  assert.match(eventLoop, /clock-stall/);
  assert.match(eventLoop, /resume_trace\.position\.clear\(\)/);
});
test("a separate low-cost watchdog detects event thread deadlocks", () => {
  assert.match(eventLoop, /mpv-resume-watchdog/);
  assert.match(eventLoop, /RESUME_EVENT_LOOP_STALL/);
  assert.match(eventLoop, /event-loop-stall/);
  assert.match(eventLoop, /watch_running\.store\(false/);
  assert.match(eventLoop, /watch_playing\.store\(false/);
  assert.match(eventLoop, /std::thread::sleep\(Duration::from_secs\(1\)\)/);
});
test("diagnostic lines contain only numbers flags and fixed enums, no sensitive IDs or state-changing mpv calls", () => {
  assert.doesNotMatch(section, /set_property\(|mpv_argv_command\(|loadfile|http:|https:/);
  assert.match(section, /if name == "current-ao" => match \*s/);
  assert.match(section, /if name == "hwdec-current" => match \*s/);
  assert.match(section, /source=observed/);
});
