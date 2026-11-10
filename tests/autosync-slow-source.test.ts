import assert from "node:assert/strict";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import { readFileSync } from "node:fs";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import test from "node:test";
import { denseAsrWindows } from "../src/lib/subtitles/autosync/smart-layer.ts";
import {
  runAutoSync,
  type PipelineContext,
  type TierPorts,
} from "../src/lib/subtitles/autosync/pipeline.ts";
import { unknownQuality } from "../src/lib/subtitles/autosync/fp-gate.ts";
import { shouldAttemptAudioPivot } from "../src/views/player/hooks/use-auto-sync.helpers.ts";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Whisper probing is bounded to short, distributed windows", () => {
  for (const duration of [300, 1200, 5400, 18000]) {
    const windows = denseAsrWindows(duration);
    assert.ok(windows.length >= 3 && windows.length <= 4);
    assert.ok(windows.every((w) => w.lenSec > 0 && w.lenSec <= 12));
    assert.ok(windows[0].startSec >= 0);
    assert.ok(windows.at(-1)!.startSec + 12 <= duration);
    assert.ok(windows.every((w, i) => i === 0 || w.startSec > windows[i - 1].startSec));
  }
});

test("slow-source timeouts do not falsely state that playback itself is slow", () => {
  const hook = read("src/views/player/hooks/use-auto-sync.ts");
  assert.match(hook, /couldn't finish verifying the subtitle timing through a separate audio read/);
  assert.match(hook, /Try Sync from playback to analyze buffered audio/);
  assert.doesNotMatch(hook, /This source isn't serving the audio quickly enough/);
  assert.match(hook, /verification-timeout/);
});

test("remote held-out scoring retains provenance and avoids repeat source reads", () => {
  const scorer = read("src-tauri/src/subsync/scorer.rs");
  const windows = read("src-tauri/src/subsync/analysis_windows.rs");
  assert.match(scorer, /decode_speech_cached\(&url, &hdrs, &windows, &map\)/);
  assert.match(scorer, /remote_cue_aware_windows\(duration_sec, &cues\)/);
  assert.match(scorer, /direct_excluded_windows\(duration_sec, &excluded_ids, &cues, true\)/);
  assert.match(scorer, /CachedAudioWindow/);
  assert.match(scorer, /MAX_CACHED_WINDOWS/);
  assert.match(scorer, /decode_speech_cached\(url, headers, windows, map_spec\)/);
  assert.match(scorer, /score_audio_key/);
  assert.match(windows, /REMOTE_VALIDATION_WINDOW_SEC: f32 = 20\.0/);
  assert.match(windows, /windows_are_disjoint\(&remote, &fit_windows\(duration\)\)/);
});

test("remote baseline timeout returns before VAD, ASR, or a second quality read", async () => {
  for (const sourceKind of ["http", "hls", "debrid"] as const) {
    const ctx: PipelineContext = {
      mediaUrl: "https://example.test/movie",
      sourceKind,
      durationSec: 5400,
      cues: [
        [20, 22],
        [70, 73],
        [120, 123],
        [200, 204],
      ],
      cueText: ["one line", "two lines", "more lines", "last line"],
      audioLanguage: "ko",
      subtitleLanguage: "en",
      languages: ["en"],
      subtitleFormat: "srt",
    };
    let qualityCalls = 0;
    let vadCalls = 0;
    let asrCalls = 0;
    const ports: TierPorts = {
      measureQuality: async () => {
        qualityCalls += 1;
        return unknownQuality("timeout", "test-slow-http");
      },
      consensus: async () => ({
        verdict: "right",
        bestCandidate: null,
        agreement: 0.85,
        // A consensus-derived timing candidate must still not bypass
        // independent audio verification once that source has timed out.
        textAnchors: Array.from({ length: 8 }, (_, i): [number, number] => [
          100 + i * 10,
          102 + i * 10,
        ]),
      }),
      vadAffine: async () => {
        vadCalls += 1;
        return null;
      },
      asrTranscribe: async () => {
        asrCalls += 1;
        return { phrases: [], detectedLanguage: "ko" };
      },
    };
    const outcome = await runAutoSync(ctx, ports);
    assert.equal(outcome.decision.decision, "offer");
    assert.equal(outcome.decision.bindingRule, "consensus-audio-unverified");
    assert.match(outcome.decision.reason, /audio could not be verified/);
    assert.equal(outcome.bestEffort, true);
    assert.ok(outcome.candidate?.kind === "affine");
    if (outcome.candidate?.kind === "affine") {
      assert.ok(Math.abs(outcome.candidate.offsetSec - 2) < 0.01);
      assert.equal(outcome.candidate.ratio, 1);
    }
    assert.equal(qualityCalls, 1, "the same stream must not be re-read after timeout");
    assert.equal(vadCalls, 0);
    assert.equal(asrCalls, 0);
    assert.ok(outcome.tiersRun.includes("consensus"));
    assert.equal(shouldAttemptAudioPivot(outcome), false);
  }
});

test("local baseline timeout may still attempt independent audio analysis", async () => {
  let vadCalls = 0;
  const outcome = await runAutoSync(
    {
      mediaUrl: "/movie.mkv",
      sourceKind: "local",
      durationSec: 5400,
      cues: [
        [20, 22],
        [70, 73],
        [120, 123],
        [200, 204],
      ],
      audioLanguage: "en",
      subtitleLanguage: "en",
      languages: ["en"],
    },
    {
      measureQuality: async () => unknownQuality("timeout", "test-local"),
      vadAffine: async () => {
        vadCalls += 1;
        return null;
      },
    },
  );
  assert.equal(vadCalls, 1);
  assert.equal(outcome.decision.decision, "refuse");
});

test("remote UI has a hard deadline below one minute", () => {
  const hook = read("src/views/player/hooks/use-auto-sync.ts");
  assert.match(hook, /REMOTE_ANALYSIS_DEADLINE_MS = 55_000/);
  assert.match(
    hook,
    /sourceKind === "http" \|\| sourceKind === "hls" \|\| sourceKind === "debrid"/,
  );
  assert.match(hook, /\? REMOTE_ANALYSIS_DEADLINE_MS\s*: ANALYSIS_DEADLINE_MS/);
  const popover = read("src/components/player/autosync/autosync-popover.tsx");
  assert.match(popover, /phase === "listening" \|\| phase === "analyzing"/);
  assert.match(popover, /Cancel sync/);
});

test("no unverified offer without enough corroborating anchors and a safe offset", async () => {
  const ctx: PipelineContext = {
    mediaUrl: "https://example.test/movie",
    sourceKind: "http",
    durationSec: 3600,
    cues: [
      [30, 32],
      [60, 62],
      [90, 92],
      [120, 122],
    ],
    cueText: ["a sentence", "another sentence", "third sentence", "fourth sentence"],
    audioLanguage: "ja",
    subtitleLanguage: "en",
    subtitleFormat: "srt",
    languages: ["en"],
  };
  const scenarios: Array<{ anchors: Array<[number, number]> | null; agreement: number }> = [
    { anchors: null, agreement: 1 },
    { anchors: Array.from({ length: 7 }, (_, i) => [100 + i * 20, 105 + i * 20]), agreement: 1 },
    { anchors: Array.from({ length: 8 }, (_, i) => [100 + i * 20, 105 + i * 20]), agreement: 0.5 },
    { anchors: Array.from({ length: 8 }, (_, i) => [100 + i * 20, 180 + i * 20]), agreement: 1 },
    { anchors: Array.from({ length: 8 }, (_, i) => [100 + i * 20, 100 + i * 20]), agreement: 1 },
  ];
  for (const scenario of scenarios) {
    const outcome = await runAutoSync(ctx, {
      measureQuality: async () => unknownQuality("timeout", "unseekable"),
      consensus: async () => ({
        verdict: "right",
        bestCandidate: null,
        agreement: scenario.agreement,
        textAnchors: scenario.anchors,
      }),
      vadAffine: async () => {
        throw Error("must not open a second audio stream");
      },
    });
    assert.equal(outcome.decision.decision, "refuse");
    assert.equal(outcome.decision.bindingRule, "quality-measurement");
    assert.equal(outcome.candidate, null);
    assert.equal(shouldAttemptAudioPivot(outcome), false);
  }
});

test("only an audio-verified candidate can auto-apply; unverified reference offer is manual", () => {
  const referenceOffer = {
    candidate: { kind: "affine" as const, offsetSec: 2, ratio: 1 },
    decision: {
      decision: "offer" as const,
      transform: { kind: "affine" as const, offsetSec: 2, ratio: 1 },
      bindingRule: "consensus-audio-unverified",
      reason: "timing reference only",
      pCorrect: 0.5,
    },
    evidence: [],
    tiersRun: [],
    bestEffort: true,
  };
  assert.equal(shouldAttemptAudioPivot(referenceOffer), false);
  assert.equal(
    shouldAttemptAudioPivot({
      ...referenceOffer,
      decision: {
        ...referenceOffer.decision,
        decision: "apply" as const,
        bindingRule: "audio-verified",
      },
    }),
    false,
  );
  assert.equal(
    shouldAttemptAudioPivot({
      ...referenceOffer,
      decision: { ...referenceOffer.decision, bindingRule: "no-candidate" },
    }),
    true,
  );
  const hook = read("src/views/player/hooks/use-auto-sync.ts");
  assert.match(hook, /o\.decision\.bindingRule !== "consensus-audio-unverified"/);
  const popover = read("src/components/player/autosync/autosync-popover.tsx");
  assert.match(
    popover,
    /Reference subtitles suggest a shift, but video audio verification was unavailable/,
  );
  assert.match(popover, /unverifiedAudio=\{handle\.offer\?\.decision\.bindingRule/);
});

test("strong subtitle timing references create an explicit manual offer when remote audio is unseekable", async () => {
  const durationSec = 7200;
  const cues = Array.from({ length: 600 }, (_, i): [number, number] => [
    20 + i * 11.8,
    23 + i * 11.8,
  ]);
  const result = await runAutoSync(
    {
      mediaUrl: "https://example.test/movie",
      sourceKind: "http",
      durationSec,
      cues,
      cueText: cues.map((_, i) => `Line number ${i} for dialogue`),
      subtitleFormat: "srt",
      audioLanguage: "ja",
      subtitleLanguage: "en",
      languages: ["en"],
    },
    {
      measureQuality: async () => unknownQuality("timeout", "unseekable"),
      consensus: async () => ({
        verdict: "right",
        bestCandidate: null,
        agreement: 0.92,
        textAnchors: Array.from({ length: 12 }, (_, i): [number, number] => [
          100 + i * 120,
          104 + i * 120,
        ]),
      }),
      vadAffine: async () => {
        throw new Error("must not read remote media after timeout");
      },
    },
    { allowStructuralAutoApply: true },
  );
  assert.equal(result.decision.decision, "offer", result.decision.reason);
  assert.equal(result.decision.bindingRule, "consensus-audio-unverified");
  assert.equal(result.bestEffort, true);
  assert.equal(result.candidate?.kind, "affine");
  if (result.candidate?.kind === "affine") {
    assert.ok(Math.abs(result.candidate.offsetSec - 4) < 0.001);
    assert.equal(result.candidate.ratio, 1);
  }
  assert.equal(shouldAttemptAudioPivot(result), false);
});
