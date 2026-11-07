import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  boundedNativeProbe,
  supportsCurrentSceneRead,
  shouldReadIndependentSceneAudio,
} from "../src/lib/subtitles/autosync/current-scene.ts";

test("scene-read route targets normal remote URLs, not private loopback or files", () => {
  assert.equal(supportsCurrentSceneRead("https://cdn.example.test/show.mkv"), true);
  assert.equal(supportsCurrentSceneRead("http://cdn.example.test/show.mp4"), true);
  assert.equal(supportsCurrentSceneRead("http://localhost:11470/stream"), false);
  assert.equal(supportsCurrentSceneRead("http://127.0.0.1:4500/stream"), false);
  assert.equal(supportsCurrentSceneRead("http://[::1]:4500/stream"), false);
  assert.equal(supportsCurrentSceneRead("file:///tmp/test.mkv"), false);
  assert.equal(supportsCurrentSceneRead("data:text/plain,foo"), false);
  assert.equal(supportsCurrentSceneRead("not-a-url"), false);
});

test("a completed current-scene read does not cancel the native job", async () => {
  let cancelled = 0;
  const result = await boundedNativeProbe(
    () => Promise.resolve({ offsetSec: 4.2 }),
    () => {
      cancelled += 1;
    },
    100,
  );
  assert.deepEqual(result, { offsetSec: 4.2 });
  assert.equal(cancelled, 0);
});

test("a stuck source-local decode times out and cancels the native job", async () => {
  let cancelled = 0;
  await assert.rejects(
    boundedNativeProbe(
      () => new Promise<never>(() => {}),
      () => {
        cancelled += 1;
      },
      20,
    ),
    /subsync-scene-timeout/,
  );
  assert.equal(cancelled, 1);
});

test("remote reads are skipped on fallback, and cache audio must be verified before matching", () => {
  const remote = "https://cdn.example.test/movie.mkv";
  assert.equal(shouldReadIndependentSceneAudio(true, remote), false);
  assert.equal(shouldReadIndependentSceneAudio(false, remote), true);
  assert.equal(shouldReadIndependentSceneAudio(undefined, remote), true);
  assert.equal(shouldReadIndependentSceneAudio({ type: "click" }, remote), true);
  assert.equal(shouldReadIndependentSceneAudio(false, "http://127.0.0.1:2000/stream"), false);
  const hook = readFileSync(
    new URL("../src/views/player/hooks/use-auto-sync.ts", import.meta.url),
    "utf8",
  );
  const directIndex = hook.indexOf(
    "if (scene && shouldReadIndependentSceneAudio(preferBufferedAudio, active.url))",
  );
  const recorderIndex = hook.search(/cmd: \[\s*"dump-cache",/);
  assert.ok(directIndex > 0 && recorderIndex > directIndex);
  const remoteBlock = hook.slice(directIndex, recorderIndex);
  assert.match(remoteBlock, /mapSpec: audioStreamMap\(liveSnapRef\.current\) \?\? "0:a:0"/);
  assert.match(remoteBlock, /windowStartSec: startAt/);
  assert.match(remoteBlock, /durationSec: clipSec/);
  assert.match(remoteBlock, /playbackClip: true/);
  assert.match(remoteBlock, /sessionId: sceneSessionId/);
  assert.match(remoteBlock, /25_000/);
  assert.match(remoteBlock, /decision: "offer"/);
  assert.doesNotMatch(remoteBlock, /decision: "apply"/);
  assert.match(remoteBlock, /throw new Error\("subsync-scene-no-reliable-match"\)/);
  assert.match(remoteBlock, /fallback=playback-cache reason=source-/);
  assert.doesNotMatch(remoteBlock, /Reading nearby dialogue audio timed out/);
  assert.match(
    hook,
    /playbackFallbackRef\.current = \(preferBufferedAudio\) => listen\(preferBufferedAudio\)/,
  );
  assert.match(hook, /scene-read=skipped reason=buffered-playback-selected/);
  assert.match(hook, /subsync_prepare_cache_audio/);
  assert.match(hook, /input: recordPath\.replace[^}]*mapSpec: "0:a:0"/);
});
