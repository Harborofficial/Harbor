// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import test from "node:test";
import {
  DEFAULT_BUNDLE,
  type CalibrationBundle,
} from "../src/lib/subtitles/autosync/calibration.ts";
import {
  measuredQuality,
  unknownQuality,
  type QualityMeasurementRequest,
} from "../src/lib/subtitles/autosync/fp-gate.ts";
import {
  DIRECT_EXPLICIT_HELD_OUT_PROVENANCE,
  DIRECT_HELD_OUT_PROVENANCE,
} from "../src/lib/subtitles/autosync/direct-validation.ts";
import {
  PIVOT_HELD_OUT_PROVENANCE,
  PIVOT_VAD_HELD_OUT_PROVENANCE,
  isExperimentalPivotEligible,
  pivotHeldOutQualityRequest,
  preferAutoSyncOutcome,
  runExperimentalPivotAutoSync,
  type PivotRuntimeSettings,
} from "../src/lib/subtitles/autosync/pivot-runtime.ts";
import type {
  PipelineContext,
  PipelineOutcome,
  TierPorts,
} from "../src/lib/subtitles/autosync/pipeline.ts";
import type { PreparedSubtitle } from "../src/lib/subtitles/prepare.ts";
import type { SubResult, SubSearchQuery } from "../src/lib/subtitles/types.ts";
import type { PlayerSrc } from "../src/lib/view.tsx";
import { DEFAULT_DRIFT_CONFIG, localFit } from "../src/lib/subtitles/autosync/drift-dsp.ts";
import { PIVOT_CUES, TARGET_CUES } from "./fixtures/subtitle-p2-fixtures.ts";

const SETTINGS: PivotRuntimeSettings = {
  subtitleAutoSyncPivot: true,
  autoSyncApplyStructural: true,
  subProvidersEnabled: {
    wyzie: false,
    opensubtitles: true,
    jimaku: false,
    addons: false,
    subdl: false,
    subsource: false,
  },
  subdlApiKey: "",
  subsourceApiKey: "",
};

const SOURCE: PlayerSrc = {
  meta: { id: "tt1234567", type: "movie", name: "Pivot Example" },
  imdbId: "tt1234567",
  url: "https://media.example/video.mkv",
  title: "Pivot Example",
  streamRef: {
    title: "Pivot.Example.1080p.WEB-DL-GROUP",
    source: "WEB-DL",
    resolution: "1080p",
    size: 1_000_000,
  },
};

const CONTEXT: PipelineContext = {
  mediaUrl: SOURCE.url,
  sourceKind: "http",
  durationSec: 100,
  cues: TARGET_CUES.map((cue) => [cue.start, cue.end]),
  cueText: TARGET_CUES.map((cue) => cue.text),
  moviebytesize: SOURCE.streamRef?.size ?? undefined,
  audioLanguage: "en",
  subtitleLanguage: "ar",
  preferredSubtitleLanguages: ["ar"],
  subtitleFormat: "srt",
  languages: ["ar"],
  meta: { imdbId: SOURCE.imdbId },
};

const RESULT: SubResult = {
  id: "release-match",
  url: "https://subs.example/pivot.srt",
  lang: "en",
  source: "opensubtitles",
  format: "srt",
  release: SOURCE.streamRef?.title ?? undefined,
  downloads: 400,
  providerMatch: { confidence: "exact", score: 1, matchedBy: ["release"] },
};

function prepared(cleanup: () => void): PreparedSubtitle {
  return {
    originalUrl: RESULT.url,
    playableUrl: "blob:pivot",
    format: "srt",
    cues: PIVOT_CUES,
    text: PIVOT_CUES.map((cue) => cue.text).join("\n"),
    encoding: "utf-8",
    encodingHealth: 1,
    encodingDiagnostics: [],
    release: RESULT.release,
    rawFilename: "pivot.srt",
    archive: false,
    cleanup,
  };
}

function releaseReadyCalibration(): CalibrationBundle {
  return {
    ...DEFAULT_BUNDLE,
    provisional: false,
    metrics: {
      n: 1_000,
      eceBefore: 0.02,
      eceAfter: 0.01,
      brierBefore: 0.03,
      brierAfter: 0.02,
      falseApplyUpper: 0.001,
      appliedN: 500,
      falseApplies: 0,
    },
  };
}

function measuredPorts(targetMeasured = true, observedTargetCueCounts: number[] = []): TierPorts {
  return {
    measureQuality: async (ctx, transform, request) => {
      if (ctx.subtitleLanguage === "en") {
        const validationWindows = request?.validationWindows;
        return measuredQuality(
          { ncc: 0.9, coverage: 0.85, z: 4 },
          "pivot-audio",
          request?.purpose === "validation"
            ? {
                kind: "held-out",
                windowIds: validationWindows?.map((window) => window.id) ?? [
                  "validation-middle-a",
                  "validation-middle-b",
                ],
                ...(validationWindows ? { windows: validationWindows } : {}),
                provenance: validationWindows
                  ? DIRECT_EXPLICIT_HELD_OUT_PROVENANCE
                  : DIRECT_HELD_OUT_PROVENANCE,
                ...(request.validationProvenance
                  ? { requestProvenance: request.validationProvenance }
                  : {}),
              }
            : undefined,
        );
      }
      observedTargetCueCounts.push(ctx.cues.length);
      if (!targetMeasured) return unknownQuality("insufficient-data", "held-out-target");
      const offset = transform.kind === "affine" ? Math.abs(transform.offsetSec) : 1;
      return measuredQuality(
        offset < 0.1 ? { ncc: 0.4, coverage: 0.8, z: 1 } : { ncc: 0.7, coverage: 0.8, z: 3 },
        "held-out-target",
        request?.validationWindows
          ? {
              kind: "held-out",
              windowIds: request.validationWindows.map((window) => window.id),
              windows: request.validationWindows,
              provenance: DIRECT_EXPLICIT_HELD_OUT_PROVENANCE,
              requestProvenance: request.validationProvenance,
            }
          : undefined,
      );
    },
  };
}

function dependencies(
  options: {
    cleanup?: () => void;
    calibration?: CalibrationBundle;
    onSearch?: (query: SubSearchQuery) => void;
  } = {},
) {
  return {
    searchSubtitles: async (query: SubSearchQuery) => {
      options.onSearch?.(query);
      return [RESULT];
    },
    gatherSubtitleAddons: async () => [],
    prepareSubtitle: async () => prepared(options.cleanup ?? (() => {})),
    calibration: options.calibration,
  };
}

function outcome(decision: "refuse" | "offer" | "apply", pCorrect: number): PipelineOutcome {
  const transform = { kind: "affine" as const, offsetSec: 0, ratio: 1 };
  return {
    decision: {
      decision,
      reason: "base",
      pCorrect,
      transform,
      bindingRule: "base",
    },
    candidate: transform,
    evidence: [],
    tiersRun: [],
  };
}

test("Whisper timing offers the same fixed shift in either language direction only after separate audio validation", async () => {
  const sampledWindows = [60, 250, 445].map((startSec) => ({ startSec, lenSec: 12 }));
  const spoken = sampledWindows.flatMap(({ startSec }) =>
    [
      [0.6, 1.4],
      [2.7, 4.8],
      [6.3, 7.2],
      [9.2, 11.6],
    ].map(([a, b]) => ({ start: startSec + a, end: startSec + b })),
  );
  for (const [audioLanguage, subtitleLanguage] of [
    ["en", "de"],
    ["de", "en"],
    ["he", "el"],
  ]) {
    const offset = subtitleLanguage === "en" ? -3.5 : 2.5;
    const audio: Array<[number, number]> = spoken.map((p) => [p.start, p.end]);
    for (const center of [125, 275, 375])
      for (const delta of [-6, -2, 2, 6]) audio.push([center + delta, center + delta + 2]);
    const cues: Array<[number, number]> = audio
      .sort((a, b) => a[0] - b[0])
      .map(([a, b]) => [a - offset, b - offset]);
    const ctx = {
      ...CONTEXT,
      audioLanguage,
      subtitleLanguage,
      durationSec: 500,
      cues,
      cueText: cues.map((_, i) => `different written dialogue ${i}`),
    };
    const args = { ctx, settings: SETTINGS, src: SOURCE };
    const requests: QualityMeasurementRequest[] = [];
    const ports: TierPorts = {
      asrTranscribe: async () => ({
        phrases: spoken.map((p) => ({ ...p, text: "spoken" })),
        detectedLanguage: audioLanguage,
        sampledWindows,
      }),
      measureQuality: async (_ctx, t, request) => {
        assert.ok(request?.validationWindows);
        requests.push(request!);
        const windows = request!.validationWindows!;
        assert.ok(
          windows.every((w) =>
            sampledWindows.every(
              (s) => w.toSec <= s.startSec || w.fromSec >= s.startSec + s.lenSec,
            ),
          ),
        );
        assert.equal(t.kind, "affine");
        const subtitles = cues.map(([start, end]) => ({ start, end, text: "caption" }));
        const fits = windows.map((w) =>
          localFit(audio, subtitles, t.kind === "affine" ? t.offsetSec : 0, [w.fromSec, w.toSec], {
            ...DEFAULT_DRIFT_CONFIG,
            maxLagSec: 0,
          }),
        );
        return measuredQuality(
          {
            ncc: Math.min(...fits.map((f) => f.ncc)),
            coverage: Math.min(...fits.map((f) => f.coverage)),
            z: 0,
          },
          "audio",
          {
            kind: "held-out",
            windows,
            provenance: DIRECT_EXPLICIT_HELD_OUT_PROVENANCE,
            windowIds: windows.map((w) => w.id),
            requestProvenance: request!.validationProvenance,
          },
        );
      },
    };
    const deps = { ...dependencies(), searchSubtitles: async () => [] };
    const out = await runExperimentalPivotAutoSync({ ...args, ports }, deps);
    assert.equal(out?.decision.decision, "offer");
    assert.equal(out?.decision.bindingRule, "cross-language-speech-timing");
    assert.deepEqual(out?.candidate, { kind: "affine", ratio: 1, offsetSec: offset });
    assert.equal(requests.length, 2);
    assert.deepEqual(requests[0], requests[1]);
    assert.equal(
      await runExperimentalPivotAutoSync(
        {
          ...args,
          ports: {
            ...ports,
            measureQuality: async () => unknownQuality("timeout", "audio"),
          },
        },
        deps,
      ),
      null,
    );
    assert.equal(
      await runExperimentalPivotAutoSync(
        {
          ...args,
          ports: {
            ...ports,
            asrTranscribe: async () => ({
              detectedLanguage: audioLanguage,
              sampledWindows,
              phrases: spoken.slice(0, 4).map((p) => ({ ...p, text: "spoken" })),
            }),
          },
        },
        deps,
      ),
      null,
    );
    // A repeated subtitle pattern creates two equally plausible offsets.
    const repeated = cues.flatMap(([a, b]): Array<[number, number]> => [
      [a, b],
      [a + 16, b + 16],
    ]);
    assert.equal(
      await runExperimentalPivotAutoSync(
        {
          ...args,
          ctx: {
            ...ctx,
            cues: repeated,
            cueText: repeated.map((_, i) => `repeated dialogue ${i}`),
          },
          ports,
        },
        deps,
      ),
      null,
    );
    assert.equal(
      requests.length,
      2,
      "ambiguous or single-scene matches must not reach verification",
    );
  }
});

test("cross-language drift reaches independent audio validation as a rate change and remains offer-only", async () => {
  const sampledWindows = [100, 800, 1600, 2400].map((startSec) => ({ startSec, lenSec: 30 }));
  const phrases = sampledWindows.flatMap(({ startSec }) =>
    [
      [1, 3.2],
      [6.1, 9.4],
      [13, 15.1],
      [19.2, 23.8],
      [26, 28.4],
    ].map(([a, b]) => ({ start: startSec + a, end: startSec + b, text: "speech" })),
  );
  const audio: Array<[number, number]> = phrases.map((p) => [p.start, p.end]);
  for (const center of [675, 1350, 2025])
    for (const delta of [-6, -2, 2, 6]) audio.push([center + delta, center + delta + 2]);
  const cues: Array<[number, number]> = audio
    .sort((a, b) => a[0] - b[0])
    .map(([a, b]) => [(a - 0.7) / 1.002, (b - 0.7) / 1.002]);
  const ctx = {
    ...CONTEXT,
    durationSec: 2700,
    audioLanguage: "en",
    subtitleLanguage: "el",
    cues,
    cueText: cues.map((_, i) => `translated dialogue ${i}`),
  };
  let measured = 0;
  const ports: TierPorts = {
    asrTranscribe: async (_ctx, requested) => {
      assert.ok(requested.every((w) => w.lenSec === 30));
      return { phrases, sampledWindows, detectedLanguage: "en" };
    },
    measureQuality: async (_ctx, transform, request) => {
      assert.equal(transform.kind, "affine");
      if (transform.kind !== "affine") throw new Error("expected affine");
      const windows = request!.validationWindows!;
      assert.ok(
        windows.every((w) =>
          sampledWindows.every((s) => w.toSec <= s.startSec || w.fromSec >= s.startSec + s.lenSec),
        ),
      );
      const shifted = cues.map(([a, b]) => ({
        start: a * transform.ratio + transform.offsetSec,
        end: b * transform.ratio + transform.offsetSec,
        text: "translated",
      }));
      const fits = windows.map((w) =>
        localFit(audio, shifted, 0, [w.fromSec, w.toSec], {
          ...DEFAULT_DRIFT_CONFIG,
          maxLagSec: 0,
        }),
      );
      measured++;
      return measuredQuality(
        {
          ncc: Math.min(...fits.map((f) => f.ncc)),
          coverage: Math.min(...fits.map((f) => f.coverage)),
          z: 0,
        },
        "audio",
        {
          kind: "held-out",
          windows,
          provenance: DIRECT_EXPLICIT_HELD_OUT_PROVENANCE,
          windowIds: windows.map((w) => w.id),
          requestProvenance: request!.validationProvenance,
        },
      );
    },
  };
  const args = { ctx, ports, settings: SETTINGS, src: SOURCE };
  const deps = { ...dependencies(), searchSubtitles: async () => [] };
  const result = await runExperimentalPivotAutoSync(args, deps);
  assert.equal(result?.decision.decision, "offer");
  assert.equal(result?.candidate?.kind, "affine");
  assert.ok(
    result?.candidate?.kind === "affine" && Math.abs(result.candidate.ratio - 1.002) < 0.0001,
  );
  assert.equal(measured, 2);
  assert.equal(
    await runExperimentalPivotAutoSync(
      {
        ...args,
        ports: { ...ports, measureQuality: async () => unknownQuality("timeout", "audio") },
      },
      deps,
    ),
    null,
  );
});

test("experimental pivot is off by default and never runs for a same-language track", async () => {
  let searches = 0;
  const deps = dependencies({ onSearch: () => searches++ });
  const disabled = await runExperimentalPivotAutoSync(
    {
      ctx: CONTEXT,
      ports: measuredPorts(),
      settings: { ...SETTINGS, subtitleAutoSyncPivot: false },
      src: SOURCE,
    },
    deps,
  );
  const sameLanguage = await runExperimentalPivotAutoSync(
    {
      ctx: { ...CONTEXT, subtitleLanguage: "eng" },
      ports: measuredPorts(),
      settings: SETTINGS,
      src: SOURCE,
    },
    deps,
  );
  assert.equal(disabled, null);
  assert.equal(sameLanguage, null);
  assert.equal(searches, 0);
  assert.equal(isExperimentalPivotEligible(CONTEXT, SETTINGS), true);
});

test("pivot held-out requests preserve the exact anchor-derived audio ranges", () => {
  const request = pivotHeldOutQualityRequest(
    [
      { sourceSec: 10, expectedTargetSec: 12, fromSec: 4, toSec: 20 },
      { sourceSec: 40, expectedTargetSec: 42, fromSec: 34, toSec: 50 },
      { sourceSec: 70, expectedTargetSec: 72, fromSec: 64, toSec: 80 },
    ],
    100,
  );
  assert.equal(request?.validationProvenance, PIVOT_HELD_OUT_PROVENANCE);
  assert.deepEqual(
    request?.validationWindows?.map(({ fromSec, toSec }) => [fromSec, toSec]),
    [
      [4, 20],
      [34, 50],
      [64, 80],
    ],
  );
  assert.equal(
    pivotHeldOutQualityRequest(
      [
        { sourceSec: 10, expectedTargetSec: 12, fromSec: 4, toSec: 20 },
        { sourceSec: 15, expectedTargetSec: 17, fromSec: 9, toSec: 25 },
        { sourceSec: 70, expectedTargetSec: 72, fromSec: 64, toSec: 80 },
      ],
      100,
    ),
    null,
  );
});

test("pivot VAD validation excludes every fit window", async () => {
  const pivotRequests: Array<{
    offsetSec: number;
    request: QualityMeasurementRequest | undefined;
  }> = [];
  const ports = measuredPorts();
  ports.vadAffine = async () => ({
    transform: { kind: "affine", offsetSec: 1.25, ratio: 1 },
    quality: { ncc: 0.82, coverage: 0.78, z: 3.2 },
    fitWindowIds: ["fit-early", "fit-late"],
  });
  const baseMeasure = ports.measureQuality;
  ports.measureQuality = async (ctx, transform, request) => {
    if (ctx.subtitleLanguage === "en" && transform.kind === "affine") {
      pivotRequests.push({ offsetSec: transform.offsetSec, request });
    }
    return baseMeasure(ctx, transform, request);
  };

  await runExperimentalPivotAutoSync(
    { ctx: CONTEXT, ports, settings: SETTINGS, src: SOURCE },
    dependencies(),
  );

  assert.deepEqual(
    pivotRequests.map(({ offsetSec }) => offsetSec),
    [0, 1.25],
  );
  assert.ok(
    pivotRequests.every(
      ({ request }) =>
        request?.validationProvenance === PIVOT_VAD_HELD_OUT_PROVENANCE &&
        request.excludeWindowIds?.join(",") === "fit-early,fit-late",
    ),
  );
});

test("pivot VAD requires a material improvement with trusted matching held-out evidence", async () => {
  const run = async ({
    fittedNcc,
    fittedCoverage = 0.85,
    identityNcc = 0.7,
    fittedProvenance = DIRECT_HELD_OUT_PROVENANCE,
    fittedRequestProvenance,
    fittedWindowIds = ["validation-middle-a", "validation-middle-b"],
    fitWindowIds = ["fit-early", "fit-late"],
  }: {
    fittedNcc: number;
    fittedCoverage?: number;
    identityNcc?: number;
    fittedProvenance?: string;
    fittedRequestProvenance?: string;
    fittedWindowIds?: string[];
    fitWindowIds?: string[] | null;
  }) => {
    const ports = measuredPorts();
    ports.vadAffine = async () => ({
      transform: { kind: "affine", offsetSec: 1.25, ratio: 1 },
      quality: { ncc: 0.82, coverage: 0.78, z: 3.2 },
      ...(fitWindowIds ? { fitWindowIds } : {}),
    });
    const baseMeasure = ports.measureQuality;
    ports.measureQuality = async (ctx, transform, request) => {
      if (ctx.subtitleLanguage !== "en" || transform.kind !== "affine") {
        return baseMeasure(ctx, transform, request);
      }
      const fitted = Math.abs(transform.offsetSec - 1.25) < 0.001;
      return measuredQuality(
        {
          ncc: fitted ? fittedNcc : identityNcc,
          coverage: fitted ? fittedCoverage : 0.85,
          z: fitted ? 4 : 3,
        },
        "pivot-audio",
        {
          kind: "held-out",
          windowIds: fitted ? fittedWindowIds : ["validation-middle-a", "validation-middle-b"],
          provenance: fitted ? fittedProvenance : DIRECT_HELD_OUT_PROVENANCE,
          requestProvenance:
            fitted && fittedRequestProvenance !== undefined
              ? fittedRequestProvenance
              : request?.validationProvenance,
        },
      );
    };
    return runExperimentalPivotAutoSync(
      { ctx: CONTEXT, ports, settings: SETTINGS, src: SOURCE },
      dependencies(),
    );
  };

  const marginal = await run({ fittedNcc: 0.77 });
  assert.ok(
    marginal?.candidate?.kind === "affine" && Math.abs(marginal.candidate.offsetSec - 2.4) < 0.2,
  );

  const material = await run({ fittedNcc: 0.8 });
  assert.ok(
    material?.candidate?.kind === "affine" && Math.abs(material.candidate.offsetSec - 3.65) < 0.2,
  );

  const exactThreshold = await run({ fittedNcc: 0.88, identityNcc: 0.8 });
  assert.ok(
    exactThreshold?.candidate?.kind === "affine" &&
      Math.abs(exactThreshold.candidate.offsetSec - 3.65) < 0.2,
  );

  const untrusted = await run({ fittedNcc: 0.95, fittedProvenance: "untrusted-held-out-v1" });
  assert.ok(
    untrusted?.candidate?.kind === "affine" && Math.abs(untrusted.candidate.offsetSec - 2.4) < 0.2,
  );

  const mismatched = await run({
    fittedNcc: 0.95,
    fittedWindowIds: ["validation-middle-a", "validation-middle-c"],
  });
  assert.ok(
    mismatched?.candidate?.kind === "affine" &&
      Math.abs(mismatched.candidate.offsetSec - 2.4) < 0.2,
  );

  const mismatchedRequestProvenance = await run({
    fittedNcc: 0.95,
    fittedRequestProvenance: "wrong-pivot-request-v1",
  });
  assert.ok(
    mismatchedRequestProvenance?.candidate?.kind === "affine" &&
      Math.abs(mismatchedRequestProvenance.candidate.offsetSec - 2.4) < 0.2,
  );

  const insufficientCoverage = await run({ fittedNcc: 0.95, fittedCoverage: 0.3 });
  assert.ok(
    insufficientCoverage?.candidate?.kind === "affine" &&
      Math.abs(insufficientCoverage.candidate.offsetSec - 2.4) < 0.2,
  );

  const invalidFitWindowSets: Array<string[] | null> = [["fit-early", "fit-early"], null];
  for (const fitWindowIds of invalidFitWindowSets) {
    const invalidFitWindows = await run({ fittedNcc: 0.95, fitWindowIds });
    assert.ok(
      invalidFitWindows?.candidate?.kind === "affine" &&
        Math.abs(invalidFitWindows.candidate.offsetSec - 2.4) < 0.2,
    );
  }
});

test("runtime searches in the audio language and validates only held-out target cues", async () => {
  let query: SubSearchQuery | null = null;
  let cleaned = 0;
  const targetCueCounts: number[] = [];
  const result = await runExperimentalPivotAutoSync(
    {
      ctx: CONTEXT,
      ports: measuredPorts(true, targetCueCounts),
      settings: SETTINGS,
      src: SOURCE,
    },
    dependencies({ cleanup: () => cleaned++, onSearch: (value) => (query = value) }),
  );
  assert.deepEqual(query?.langs, ["en"]);
  assert.equal(query?.imdbId, SOURCE.imdbId);
  assert.equal(result?.decision.decision, "offer");
  assert.equal(result?.decision.bindingRule, "pivot-safety-ceiling");
  assert.ok(result?.candidate?.kind === "affine");
  assert.ok(
    result?.candidate?.kind === "affine" && Math.abs(result.candidate.offsetSec - 2.4) < 0.2,
  );
  assert.ok(targetCueCounts.length >= 2);
  assert.ok(targetCueCounts.every((count) => count >= 3 && count < TARGET_CUES.length));
  assert.equal(cleaned, 1);
});

test("release-ready pivot applies only when held-out audio quality is measured", async () => {
  const calibration = releaseReadyCalibration();
  const measured = await runExperimentalPivotAutoSync(
    { ctx: CONTEXT, ports: measuredPorts(), settings: SETTINGS, src: SOURCE },
    dependencies({ calibration }),
  );
  const unknown = await runExperimentalPivotAutoSync(
    { ctx: CONTEXT, ports: measuredPorts(false), settings: SETTINGS, src: SOURCE },
    dependencies({ calibration }),
  );
  assert.equal(measured?.decision.decision, "apply");
  assert.notEqual(unknown?.decision.decision, "apply");
});

test("pivot outcome augments a refusal but never displaces an existing apply", async () => {
  const pivot = await runExperimentalPivotAutoSync(
    { ctx: CONTEXT, ports: measuredPorts(), settings: SETTINGS, src: SOURCE },
    dependencies(),
  );
  assert.equal(preferAutoSyncOutcome(outcome("refuse", 0.2), pivot).decision.decision, "offer");
  assert.equal(preferAutoSyncOutcome(outcome("apply", 0.99), pivot).decision.bindingRule, "base");
});

test("provider failure leaves the normal autosync outcome untouched", async () => {
  const pivot = await runExperimentalPivotAutoSync(
    { ctx: CONTEXT, ports: measuredPorts(), settings: SETTINGS, src: SOURCE },
    {
      ...dependencies(),
      searchSubtitles: async () => {
        throw new Error("provider timeout");
      },
    },
  );
  const base = outcome("refuse", 0.3);
  assert.equal(pivot, null);
  assert.equal(preferAutoSyncOutcome(base, pivot), base);
});

test("pivot addon discovery receives the signed-in auth key", async () => {
  let discoveredWith: string | null | undefined;
  const result = await runExperimentalPivotAutoSync(
    {
      ctx: CONTEXT,
      ports: measuredPorts(),
      settings: {
        ...SETTINGS,
        subProvidersEnabled: { ...SETTINGS.subProvidersEnabled, addons: true },
      },
      src: SOURCE,
      authKey: "signed-in-auth-key",
    },
    {
      ...dependencies(),
      gatherSubtitleAddons: async (authKey) => {
        discoveredWith = authKey;
        return [];
      },
    },
  );

  assert.ok(result);
  assert.equal(discoveredWith, "signed-in-auth-key");
});
