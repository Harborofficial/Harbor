// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import { readFileSync } from "node:fs";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import test from "node:test";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

const context = read("src/lib/subtitles/autosync/context.ts");
const pipeline = read("src/lib/subtitles/autosync/pipeline.ts");
const smart = read("src/lib/subtitles/autosync/smart-layer.ts");

test("every audio and network port is timeout-bounded", () => {
  assert.match(context, /function bounded<T>\(p: Promise<T>, ms: number, fallback: T\)/);
  assert.match(context, /async function boundedMeasurement\(/);
  for (const c of [
    "SCORE_TIMEOUT_MS",
    "VAD_TIMEOUT_MS",
    "TORRENT_SCORE_TIMEOUT_MS",
    "TORRENT_VAD_TIMEOUT_MS",
    "HASH_TIMEOUT_MS",
    "CROWD_TIMEOUT_MS",
    "ASR_TIMEOUT_MS",
  ]) {
    assert.match(context, new RegExp(`const ${c} = \\d+;`));
  }
  assert.match(context, /boundedMeasurement\(\s*routeTorrent\s*\? torrentScore/);
  assert.match(context, /bounded\(\s*routeTorrent\s*\? torrentVad/);
  assert.match(context, /bounded\(rawHash\(hctx\), HASH_TIMEOUT_MS, null\)/);
  assert.match(context, /bounded\(crowdPort\(cctx\), CROWD_TIMEOUT_MS, null\)/);
  assert.match(
    context,
    /bounded\(\s*transcribe\(actx, windows\),\s*windows\.some\([\s\S]*?45_000 : ASR_TIMEOUT_MS/,
  );
});

test("scoring budgets outlast the native 25s scoring limit", () => {
  for (const c of ["SCORE_TIMEOUT_MS", "TORRENT_SCORE_TIMEOUT_MS"]) {
    const match = new RegExp(`const ${c} = (\\d+);`).exec(context);
    assert.ok(match && Number(match[1]) > 25000, `${c} must exceed the native scoring timeout`);
  }
});

test("pipeline starts consensus and quality probe in parallel, before hash", () => {
  const qStart = pipeline.indexOf(
    "const qualityBeforeP = measureQuality(ctx, IDENTITY, validationRequest);",
  );
  const cStart = pipeline.indexOf("const consensusP: Promise<ConsensusResult | null>");
  const hashStart = pipeline.indexOf("if (ports.hashExact) {");
  assert.ok(qStart >= 0 && cStart >= 0 && hashStart >= 0);
  assert.ok(qStart < hashStart && cStart < hashStart, "parallel starts must precede the hash tier");
  assert.ok(
    !/const qualityBefore = await ports\.measureQuality/.test(pipeline),
    "no eager blocking quality probe",
  );
});

test("consensus anchors produce a primary fast-apply transform", () => {
  assert.match(smart, /export function consensusAnchorFit\(\s*res: ConsensusResult,?\s*\)/);
  assert.match(smart, /const FAST_MIN_ANCHORS = 8;/);
  assert.match(smart, /const FAST_MAX_RESIDUAL = 0\.6;/);
  assert.match(pipeline, /const fastFit = consensusAnchorFit\(consensusRes\);/);
  assert.match(pipeline, /bestEffort = true;/);
  const fastTier = pipeline.indexOf("consensusAnchorFit(consensusRes)");
  const vadTier = pipeline.indexOf("if (ports.vadAffine) {");
  assert.ok(fastTier >= 0 && vadTier > fastTier, "fast consensus tier must run before audio VAD");
});

test("fast tier keeps best-effort at offer when audio cannot confirm", () => {
  assert.match(pipeline, /const be = evaluateBestEffort\(\{/);
  assert.match(pipeline, /const fastBefore = await qualityBeforeP;/);
  assert.match(pipeline, /qualityBefore: fastBefore,/);
  assert.match(pipeline, /if \(be\.decision === "offer"/);
  assert.doesNotMatch(pipeline, /if \(be\.decision === "apply"/);
});

test("single-source subtitles can still vote on the offset", () => {
  const consensus = read("src/lib/subtitles/autosync/consensus.ts");
  assert.match(consensus, /single-source fallback/);
  assert.match(consensus, /soloPeers\.length >= 2/);
  assert.match(consensus, /corroboratedReference\(soloPeers, false\)/);
  assert.match(consensus, /corroboratedReference\(peers, true\)/);
  const fallback = consensus.indexOf("single-source fallback");
  const wrongVerdict = consensus.indexOf('verdict: "wrong"');
  assert.ok(
    fallback >= 0 && wrongVerdict > fallback,
    "wrong-content verdict stays multi-source only",
  );
});

test("an already-aligned refusal is shown as aligned and a refusal reason is visible", () => {
  const hook = read("src/views/player/hooks/use-auto-sync.ts");
  assert.match(hook, /o\.decision\.bindingRule === "already-good"/);
  assert.match(hook, /setReason\(refusalReason\(o\)\)/);
  assert.match(hook, /setStatus\("aligned"\)/);
  const popover = read("src/components/player/autosync/autosync-popover.tsx");
  assert.match(popover, /\{reason &&/);
  assert.match(popover, /phase === "declined" \|\|\s*phase === "error"/);
  assert.match(popover, /phase === "aligned"\) return 2000/);
  assert.match(hook, /The selected subtitle could not be read\./);
  assert.match(hook, /readNonNetworkSubtitleBytes\(/);
  assert.doesNotMatch(hook, /convertFileSrc/);
  assert.match(hook, /let more of the video download/);
  assert.match(hook, /ANALYSIS_DEADLINE_MS = 90_000/);
  assert.match(hook, /deadlineRef\.current = window\.setTimeout/);
  assert.match(hook, /src\.playbackTraceId/);
});

test("live tap records the player's own stream instead of seeking the source", () => {
  const hook = read("src/views/player/hooks/use-auto-sync.ts");
  assert.match(hook, /"dump-cache"/);
  assert.match(hook, /mpv_get_seekable_ranges/);
  assert.match(hook, /"sync_subtitle"/);
  const popover = read("src/components/player/autosync/autosync-popover.tsx");
  assert.match(popover, /Sync from playback/);
  const mpv = read("src-tauri/src/mpv.rs");
  assert.match(mpv, /"dump-cache"/);
  // Live sync remains a guided operation, not the default Auto sync path.
  assert.match(hook, /const listen = useCallback/);
});

test("Auto sync uses the complete pipeline while Sync from playback remains distinct", () => {
  const hook = read("src/views/player/hooks/use-auto-sync.ts");
  assert.match(hook, /const run = useCallback\(\(\) => \{/);
  assert.match(hook, /if \(cls !== "torrent" && isLoopback\(active\.url\)\)/);
  assert.match(hook, /beginRun\(true\);\s*\}, \[beginRun, listen\]\);/);
  assert.match(hook, /listen: \(\) => listen\(true\),/);
  assert.doesNotMatch(
    hook,
    /if \(sourceKindFor\(cls, active\.url\) !== "local"\) \{\s*listen\(\);/,
  );
  assert.match(hook, /runAutoSync\(ctx, ports, pipelineOptions\(tryHarder\)\)/);
  const control = read("src/components/player/subtitle-menu/sync-control.tsx");
  assert.match(control, /autoSync\?\.run\(\)/);
  assert.match(control, /onLiveSync/);
});

test("cache sync verifies decoded audio while remote sources use a bounded current-scene read", () => {
  const hook = read("src/views/player/hooks/use-auto-sync.ts");
  const native = read("src-tauri/src/subsync/cache_audio.rs");
  const registration = read("src-tauri/src/lib.rs");

  assert.match(hook, /"subsync_prepare_cache_audio"/);
  assert.match(hook, /fromStart: false/);
  assert.match(hook, /reportFailures: true/);
  const matcher = read("src-tauri/src/subsync/correlate.rs");
  assert.match(matcher, /total_sec <= 90\.0/);
  assert.match(matcher, /let z_min = if short_clip \{ 4\.5 \} else \{ Z_MIN \}/);
  assert.match(matcher, /solve_with_metrics/);
  assert.match(hook, /url: prepared\.path\.replace/);
  assert.match(hook, /mapSpec: "0:a:0"/);
  assert.match(
    hook,
    /cleanupFiles\.push\(\s*\(\) =>\s*fs\.remove\(\s*(?:prepared\.path|capturePath\.replace\(\/\\\.mkv\$\/,\s*"\.wav"\))\s*\)\s*\)/,
  );
  assert.match(hook, /playbackClip: true/);
  assert.match(hook, /readBufferedRanges\(\)/);
  assert.match(hook, /url: active\.url,/);
  assert.match(hook, /windowStartSec: startAt/);
  assert.match(hook, /boundedNativeProbe\(/);
  assert.match(hook, /startAt = prepared\.startSec;/);
  assert.match(hook, /cue\.start - startAt, cue\.end - startAt/);
  assert.match(
    hook,
    /liveSyncFailureReason\(\{\s*cacheAudioReady,\s*cacheError,\s*directAttempted,\s*directError,?\s*\}\)/,
  );
  const nativeSync = read("src-tauri/src/subsync/mod.rs");
  assert.match(nativeSync, /window_start_sec: Option<f32>/);
  assert.match(nativeSync, /origin \+ window\.start_sec/);
  assert.match(nativeSync, /start - origin, end - origin/);
  assert.match(nativeSync, /subsync-analysis-busy/);
  assert.doesNotMatch(hook, /url: \(recordPath as string\)\.replace/);

  assert.match(native, /cache_dump_path\(&input\)/);
  assert.match(native, /"pcm_s16le"/);
  const vad = read("src-tauri/src/subsync/vad.rs");
  const extractor = read("src-tauri/src/subsync/extract.rs");
  assert.match(vad, /if url.starts_with/);
  assert.match(extractor, /if url.starts_with/);
  assert.match(native, /const MIN_AUDIO_SECONDS: f64 = 43\.0;/);
  assert.match(native, /"cache-audio-incomplete"/);
  assert.match(registration, /subsync::cache_audio::subsync_prepare_cache_audio/);
});

test("auto-sync is a real toggle with a visible best-effort pill", () => {
  const hook = read("src/views/player/hooks/use-auto-sync.ts");
  assert.match(hook, /stop: \(\) => void;/);
  assert.match(
    hook,
    /const stop = useCallback\(\(\) => \{\s*activeDisposeRef\.current\?\.\(\);\s*revert\(\);/,
  );
  const popover = read("src/components/player/autosync/autosync-popover.tsx");
  assert.match(popover, /case "best-effort":\s*return "synced";/);
  const menu = read("src/components/player/subtitle-menu/sync-control.tsx");
  assert.match(menu, /autoSync\?\.stop\(\);/);
  assert.match(menu, /autoSyncOn\s*\? tr\("Turn off auto-sync"\)/);
  assert.match(menu, /status === "matched-embedded"\s*\? tr\("Matched embedded subtitles"\)/);
  assert.match(popover, /status === "matched-embedded"\s*\? t\("Matched embedded subtitles"\)/);
  assert.match(menu, /aria-label=\{tr\("\{label\}, sync options", \{ label \}\)\}/);
});
