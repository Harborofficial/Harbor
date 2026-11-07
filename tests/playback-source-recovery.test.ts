import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { canReuseRecentRemotePlayback } from "../src/lib/player/continue-playback.ts";

function saved(url: string, extra: Record<string, unknown> = {}) {
  const now = 1_000_000;
  return {
    now,
    actual: {
      playedAt: now - 60_000,
      requiresSourceRefresh: false,
      src: { url, streamRef: {} },
      ...extra,
    },
  };
}

test("Continue Watching reuses recent ordinary direct links, but not stale or debrid URLs", () => {
  const direct = saved("https://cdn.example.test/video.mp4");
  assert.equal(canReuseRecentRemotePlayback(direct.actual as never, direct.now), true);
  assert.equal(canReuseRecentRemotePlayback({
    ...direct.actual, playedAt: direct.now - 2 * 60 * 60 * 1000 - 1,
  } as never, direct.now), false);
  assert.equal(canReuseRecentRemotePlayback({
    ...direct.actual, src: { ...direct.actual.src, streamRef: { infoHash: "abc123", fileIdx: 3 } },
  } as never, direct.now), false);
  assert.equal(canReuseRecentRemotePlayback({
    ...direct.actual, requiresSourceRefresh: true,
  } as never, direct.now), false);
  assert.equal(canReuseRecentRemotePlayback(
    saved("http://127.0.0.1:4567/stream/a").actual as never, direct.now,
  ), false);
});

test("manual source selection is not treated as Instant Play for startup retries or stub ejection", () => {
  const player = readFileSync(new URL("../src/views/player.tsx", import.meta.url), "utf8");
  const handler = readFileSync(
    new URL("../src/views/play-picker/use-pick-handler.ts", import.meta.url), "utf8");
  assert.match(player, /useAutoRetry\(\{[\s\S]*?instantPlay: src\.autoFired === true/);
  assert.match(player, /usePlayerExit\(\{[\s\S]*?instantPlay: src\.autoFired === true/);
  assert.match(player, /useStubDetection\(\{ src, snap, onStub: onStubEject, instantPlay: src\.autoFired === true \}\)/);
  assert.match(handler, /autoFired: autoPickRef\.current/);
  assert.match(handler, /autoPickRef\.current = auto/);
  const stub = readFileSync(
    new URL("../src/views/player/hooks/use-stub-detection.ts", import.meta.url), "utf8");
  assert.match(stub, /if \(!flag \|\| cancelled\) return/);
  assert.match(stub, /return \(\) => \{ cancelled = true; \}/);
});

test("each new picker navigation gets fresh resolution state and keeps auto-loading continuous", () => {
  const view = readFileSync(new URL("../src/lib/view.tsx", import.meta.url), "utf8");
  const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  const picker = readFileSync(new URL("../src/views/play-picker.tsx", import.meta.url), "utf8");
  assert.match(view, /const pickerRevision = \+\+pickerRevisionRef\.current/);
  assert.match(view, /kind: "picker",\s*pickerRevision,/);
  assert.match(app, /picker-\$\{picker\.pickerRevision \?\? 0\}/);
  assert.match(picker, /const showAutoTransition =\s*!pickerErrorText &&\s*!isDownload &&\s*\(autoActive \|\| resolving != null\)/);
});

test("debrid failover bypasses prepared CDN links after a media-open error", () => {
  const resolve = readFileSync(new URL("../src/lib/streams/resolve.ts", import.meta.url), "utf8");
  const retry = readFileSync(
    new URL("../src/views/player/hooks/use-auto-retry.ts", import.meta.url), "utf8");
  assert.match(resolve, /if \(refreshAfterFailure\) invalidatePreparedDebridLink\(stream, d, hint\)/);
  assert.match(resolve, /const prepared = refreshAfterFailure\s*\? null : await getPreparedDebridLink/);
  assert.match(retry, /hint,\s*true, \/\/ The original debrid link failed to open/);
});
