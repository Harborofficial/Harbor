import assert from "node:assert/strict";
import test from "node:test";
import {
  coversBufferedRange,
  selectBufferedExcerptStart,
  audioSelectionKey,
  shouldFallbackToPlayback,
} from "../src/views/player/hooks/use-auto-sync.helpers.ts";
import { isAutoSyncScopeCurrent } from "../src/lib/player/subtitle-fps.ts";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("cache availability requires exact contiguous playback coverage", () => {
  assert.equal(
    coversBufferedRange(
      [
        { start: 100, end: 112 },
        { start: 112, end: 151 },
      ],
      100,
      145,
    ),
    true,
  );
  assert.equal(
    coversBufferedRange(
      [
        { start: 100, end: 110 },
        { start: 115, end: 151 },
      ],
      100,
      145,
    ),
    false,
  );
  assert.equal(coversBufferedRange([{ start: 102, end: 151 }], 100, 145), false);
  assert.equal(coversBufferedRange([{ start: 100, end: 140 }], 100, 145), false);
  assert.equal(coversBufferedRange([], 100, 145), false);
  assert.equal(coversBufferedRange(null, 100, 145), null);
  assert.equal(coversBufferedRange([{ start: 100, end: Infinity }], 100, 145), false);
});

test("audio track changes invalidate an active subtitle analysis", () => {
  const audioA = {
    audioTracks: [
      { id: "1", selected: true },
      { id: "2", selected: false },
    ],
  };
  const audioB = {
    audioTracks: [
      { id: "1", selected: false },
      { id: "2", selected: true },
    ],
  };
  const keyA = audioSelectionKey(audioA as never);
  const keyB = audioSelectionKey(audioB as never);
  assert.notEqual(keyA, keyB);
  assert.equal(
    isAutoSyncScopeCurrent(
      { mediaKey: "movie", trackId: "sub-1", audioKey: keyA },
      { mediaKey: "movie", trackId: "sub-1", audioKey: keyB, syncedTrack: false },
    ),
    false,
  );
  assert.equal(
    isAutoSyncScopeCurrent(
      { mediaKey: "movie", trackId: "sub-1", audioKey: keyA },
      { mediaKey: "movie", trackId: "sub-1", audioKey: keyA, syncedTrack: false },
    ),
    true,
  );
});

test("candidate preflight passes the selected audio map and stops native timeout work", () => {
  const code = read("src/lib/subtitles/candidate-preflight.ts");
  assert.match(code, /mapSpec: context.audioMap \?\? null/);
  assert.match(code, /cancelNativeAnalysis\(sessionId\)/);
  assert.match(read("src/lib/subtitles/fetch-into-player.ts"), /audioMap: p.getAudioMap\?\.\(\)/);
});

test("native preflight and scoring share bounded window audio and support cancellation", () => {
  const scorer = read("src-tauri/src/subsync/scorer.rs");
  const control = read("src-tauri/src/subsync/analysis_control.rs");
  assert.match(scorer, /MAX_CACHED_WINDOWS: usize = 32/);
  assert.match(scorer, /remote_cue_aware_windows\(duration_sec, &cues\)/);
  assert.match(scorer, /decode_speech\(&url, &hdrs, &all_windows, &map\)/);
  assert.match(scorer, /analysis_control::run/);
  assert.match(control, /kill-on-drop child/);
  assert.match(control, /subsync_cancel_session/);
});

test("playback fallback validates cached ranges and bounds source-local reads", () => {
  const hook = read("src/views/player/hooks/use-auto-sync.ts");
  assert.match(hook, /"mpv_get_seekable_ranges"/);
  const mpv = read("src-tauri/src/mpv.rs");
  assert.match(mpv, /get_property\("demuxer-cache-state"\)/);
  assert.match(mpv, /get_mut\("seekable-ranges"\)/);
  assert.match(mpv, /mpv_node_to_json\(node\)/);
  assert.match(hook, /const clipSec = SCENE_CLIP_SEC/);
  assert.match(hook, /rankDialogueScenes\(sourceCues, focusSec, duration, clipSec\)/);
  assert.match(hook, /playbackClip: true/);
  assert.match(hook, /cancelNativeAnalysis\(nativeTapId\)/);
  assert.doesNotMatch(hook, /checking the current minute directly/);
});

test("user-initiated remote failures hand off to buffered analysis, never silently auto-apply", () => {
  const blocked = {
    decision: {
      decision: "refuse",
      bindingRule: "quality-measurement",
      reason:
        "pre-sync quality is unknown (timeout), so remote audio verification could not finish",
    },
  };
  const offer = { ...blocked, decision: { ...blocked.decision, decision: "offer" } };
  assert.equal(shouldFallbackToPlayback(blocked as never, "http", true), true);
  assert.equal(shouldFallbackToPlayback(blocked as never, "hls", true), true);
  assert.equal(shouldFallbackToPlayback(blocked as never, "debrid", true), true);
  assert.equal(shouldFallbackToPlayback(blocked as never, "local", true), false);
  assert.equal(shouldFallbackToPlayback(blocked as never, "http", false), false);
  assert.equal(shouldFallbackToPlayback(offer as never, "http", true), false);
  const hook = read("src/views/player/hooks/use-auto-sync.ts");
  assert.match(hook, /playbackFallbackRef\.current\(preferBufferedAudio\)/);
  assert.match(hook, /outcome\.decision\.bindingRule !== "never-worse"/);
  assert.match(hook, /shouldFallbackToPlayback\(outcome, sourceKind, tryHarder\)/);
});

test("playback fallback selects a complete cached excerpt near the viewer, even after playback moved", () => {
  assert.equal(selectBufferedExcerptStart([{ start: 100, end: 150 }], 110, 45, 7200), 105);
  assert.equal(
    selectBufferedExcerptStart(
      [
        { start: 100, end: 130 },
        { start: 130, end: 170 },
      ],
      140,
      45,
      7200,
    ),
    125,
  );
  assert.equal(
    selectBufferedExcerptStart(
      [
        { start: 100, end: 150 },
        { start: 300, end: 350 },
      ],
      310,
      45,
      7200,
    ),
    305,
  );
  assert.equal(
    selectBufferedExcerptStart(
      [
        { start: 100, end: 120 },
        { start: 122, end: 165 },
      ],
      123,
      45,
      7200,
    ),
    null,
  );
  assert.equal(selectBufferedExcerptStart([{ start: 100, end: 140 }], 120, 45, 7200), null);
  assert.equal(selectBufferedExcerptStart(null, 100, 45, 7200), null);
  assert.equal(selectBufferedExcerptStart([{ start: 100, end: Infinity }], 110, 45, 7200), null);
});

test("preflight rerenders do not cancel a user-initiated auto sync or playback fallback", () => {
  const hook = read("src/views/player/hooks/use-auto-sync.ts");
  const section = hook.slice(
    hook.indexOf("const selectedAudioKey = audioSelectionKey(snap)"),
    hook.indexOf("const revert = useCallback"),
  );
  assert.ok(section.length > 200);
  assert.doesNotMatch(section, /return \(\) => activeDisposeRef\.current\?\.\(\)/);
  assert.match(section, /beginRun\(false\);/);
  assert.match(section, /if \(stillCurrent\) return;[\s\S]*?activeDisposeRef\.current\?\.\(\)/);
});

test("paused playback prompts to resume and continues waiting instead of failing in three seconds", () => {
  const hook = read("src/views/player/hooks/use-auto-sync.ts");
  const popover = read("src/components/player/autosync/autosync-popover.tsx");
  assert.match(hook, /cached \?\? \[\{ start: playedFrom, end: position \}\]/);
  assert.match(
    hook,
    /setReason\(\s*paused \? "Resume playback to buffer audio" : "Waiting for buffered dialogue audio",?\s*\)/,
  );
  assert.match(hook, /readBufferedRanges\(\)/);
  assert.match(hook, /const position = getPlaybackPosition\(\)/);
  assert.match(popover, /phase === "listening" && handle\.reason/);
  assert.doesNotMatch(hook, /elapsed > 3_000/);
});

test("an unverified result remains visible and is exported as a classified outcome", () => {
  const popover = read("src/components/player/autosync/autosync-popover.tsx");
  const hook = read("src/views/player/hooks/use-auto-sync.ts");
  assert.match(
    popover,
    /phase === "offer" \|\| phase === "wrong" \|\| phase === "declined" \|\| phase === "error"\)/,
  );
  assert.match(popover, /return null;[\s\S]*?function AutosyncPopover/);
  assert.doesNotMatch(popover, /phase === "declined" \|\| phase === "error"\) return 7000/);
  assert.match(hook, /\[harbor\/autosync\] result=\$\{dec\} gate=\$\{o\.decision\.bindingRule\}/);
  assert.match(hook, /if \(dec === "refuse"\) \{[\s\S]*?setStatus\("declined"\)/);
});

test("manual remote sync recovers from insufficient audio verification via playback", () => {
  const base = {
    decision: {
      decision: "refuse",
      bindingRule: "no-candidate",
      reason:
        "No reliable offset was found, and audio verification was unavailable (insufficient-data).",
    },
  };
  assert.equal(shouldFallbackToPlayback(base as never, "http", true), true);
  assert.equal(shouldFallbackToPlayback(base as never, "hls", true), true);
  assert.equal(shouldFallbackToPlayback(base as never, "debrid", true), true);
  assert.equal(shouldFallbackToPlayback(base as never, "http", false), false);
  assert.equal(shouldFallbackToPlayback(base as never, "local", true), false);
  assert.equal(
    shouldFallbackToPlayback(
      {
        ...base,
        decision: { ...base.decision, bindingRule: "wrong-content" },
      } as never,
      "http",
      true,
    ),
    false,
  );
  assert.equal(
    shouldFallbackToPlayback(
      {
        ...base,
        decision: { ...base.decision, reason: "Some other failure" },
      } as never,
      "http",
      true,
    ),
    false,
  );
});

test("remote scoring uses independent subtitle-rich analysis and verification windows", () => {
  const native = read("src-tauri/src/subsync/scorer.rs");
  const windows = read("src-tauri/src/subsync/analysis_windows.rs");
  assert.match(windows, /pub fn remote_cue_aware_windows\(/);
  assert.match(windows, /windows_are_disjoint\(&verification, &fit\)/);
  assert.match(native, /remote_cue_aware_windows\(duration_sec, &cues\)/);
  assert.match(native, /audio:scoring-no-speech|scoring-no-speech-in-sampled-windows/);
  assert.match(native, /extract::speech_intervals_reference\(/);
  const nativeFit = read("src-tauri/src/subsync/mod.rs");
  assert.match(nativeFit, /remote_cue_aware_windows\(duration_sec, &cues\)\.0/);
  const context = read("src/lib/subtitles/autosync/context.ts");
  assert.match(context, /audio:heldout-provenance-rejected/);
  assert.match(context, /audio:sampled-windows-too-few-cues/);
});

test("manual remote near-zero NCC does not bypass safety and requests a separate playback recheck", () => {
  const candidate = {
    candidate: { kind: "affine", offsetSec: 11, ratio: 1 },
    decision: {
      decision: "refuse",
      bindingRule: "never-worse",
      reason: "post-sync ncc 0.00 below absolute floor",
    },
  };
  assert.equal(shouldFallbackToPlayback(candidate as never, "http", true), true);
  for (const reason of [
    "post-sync ncc 0.24 below absolute floor",
    "post-sync ncc 0.04 below absolute floor",
    "post-sync ncc -0.12 below absolute floor",
  ]) {
    assert.equal(
      shouldFallbackToPlayback(
        {
          ...candidate,
          decision: { ...candidate.decision, reason },
        } as never,
        "debrid",
        true,
      ),
      true,
    );
  }
  const weak = {
    ...candidate,
    decision: {
      ...candidate.decision,
      bindingRule: "promotion",
      reason: "confidence below offer floor",
    },
  };
  assert.equal(shouldFallbackToPlayback(weak as never, "http", true), true);
  assert.equal(shouldFallbackToPlayback(weak as never, "http", false), false);
  assert.equal(shouldFallbackToPlayback(candidate as never, "http", false), false);
  assert.equal(shouldFallbackToPlayback(candidate as never, "local", true), false);
  assert.equal(
    shouldFallbackToPlayback(
      {
        ...candidate,
        decision: { ...candidate.decision, reason: "not better than input (delta ncc -0.10)" },
      } as never,
      "http",
      true,
    ),
    false,
  );
  const hook = read("src/views/player/hooks/use-auto-sync.ts");
  assert.match(hook, /failure=\$\{failure\} stages=\$\{notes\}/);
  assert.match(hook, /correction-rejected-by-audio/);
  assert.match(hook, /playbackFallbackRef\.current\(preferBufferedAudio\)/);
});

test("native scorer identifies saturated VAD masks without interpreting them as a zero-confidence timing match", () => {
  const scorer = read("src-tauri/src/subsync/scorer.rs");
  const context = read("src/lib/subtitles/autosync/context.ts");
  assert.match(scorer, /fn occupied_fraction\(/);
  assert.match(scorer, /speech_fraction >= 0\.995/);
  assert.match(scorer, /scoring-no-speech-timing-contrast/);
  assert.match(context, /audio:timing-mask-no-contrast/);
  assert.match(context, /post:ncc-|\$\{stage\}:ncc-/);
  assert.match(context, /audio:speech-fraction-/);
});
