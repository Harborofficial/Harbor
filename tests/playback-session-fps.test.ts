import assert from "node:assert/strict";
import test from "node:test";
import { mpvBridgeHarness, playerSnapshotChanged } from "./helpers/mpv-bridge-harness";
import { actualPlaybackSnapshot } from "../src/lib/player/actual-playback";
import { readFileSync } from "node:fs";
import ts from "typescript";
import {
  restorablePlaybackSubtitleChoice,
  selectPlaybackSubtitle,
} from "../src/lib/player/subtitle-choice";
import { subtitleMediaKey, subtitleStreamKey } from "../src/lib/subtitles/subtitle-memory";

test("native subtitle FPS observations reach the player snapshot and existing actual history payload", async () => {
  const h = mpvBridgeHarness();
  await h.bridge.load({ url: "C:/fixture/video.mp4" });
  h.emit("sub-fps", 25);
  assert.equal(h.snapshot().subtitleFps, 25);
  const snapshot = {
    ...h.snapshot(),
    status: "paused" as const,
    firstFrameReady: true,
    subtitleTracks: [
      { id: "1", kind: "subtitle" as const, label: "Arabic", lang: "ara", selected: true },
    ],
  };
  const result = actualPlaybackSnapshot(
    {
      url: "C:/fixture/video.mp4",
      title: "Fixture",
      meta: { id: "local:fixture", name: "Fixture", type: "movie" },
    },
    snapshot,
    30,
    { id: "session", actor: { profileId: "one", storageProfileId: "one", accountId: null } },
  );
  assert.equal(result?.subtitle?.fpsOverride, 25);
  h.emit("sub-fps", 0);
  assert.equal(h.snapshot().subtitleFps, 0);
  assert.equal(playerSnapshotChanged()(snapshot, { ...snapshot, subtitleFps: 0 }), true);
  h.bridge.destroy();
});

test("FPS restoration waits for the intended selected subtitle and is not replayed on ordinary rerenders", async () => {
  const source = readFileSync(
    new URL("../src/views/player/hooks/use-track-autoload.ts", import.meta.url),
    "utf8",
  );
  const ast = ts.createSourceFile("autoload.ts", source, ts.ScriptTarget.Latest, true);
  let callback: ts.Node | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect") {
      const candidate = node.arguments[0];
      if (candidate?.getText(ast).includes("writeMpvSubtitleFps(")) callback = candidate;
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.ok(callback, "the existing track-restoration path must restore saved FPS");
  const compiled = ts.transpileModule(`const effect = ${callback.getText(ast)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const correct = {
    id: "7",
    kind: "subtitle",
    selected: true,
    label: "Full dialogue",
    title: "Full dialogue",
    lang: "ara",
    codec: "ass",
  };
  const wrong = { ...correct, id: "1", title: "Signs", label: "Signs" };
  const writes: unknown[] = [];
  let validity: (() => boolean) | undefined;
  const scope = {
    engine: "mpv",
    rememberedSession: {
      subtitle: {
        trackId: "1",
        title: "Full dialogue",
        lang: "ara",
        codec: "ass",
        fpsOverride: 25,
      },
    },
    src: { url: "fixture.mkv", meta: { id: "fixture" } },
    snap: { status: "paused", subtitleTracks: [wrong] },
    snapRef: { current: { subtitleTracks: [wrong] } },
    bridgeRef: { current: { canAutoSelectSubtitle: () => true } },
    playbackActor: {},
    isPlaybackActorCurrent: () => true,
    selectPlaybackSubtitle,
    restorablePlaybackSubtitleChoice,
    subtitleMediaKey,
    subtitleStreamKey,
    readRememberedSub: () => null,
    subtitleFpsAppliedRef: { current: null },
    getMpvSubtitleFpsGeneration: () => 1,
    writeMpvSubtitleFps: async (...args: unknown[]) => {
      writes.push(args[0]);
      validity = args[2] as () => boolean;
    },
    emitListToast() {},
    t: (key: string) => key,
  };
  const run = () =>
    new Function(...Object.keys(scope), `${compiled}\nreturn effect();`)(...Object.values(scope));
  run();
  assert.deepEqual(writes, []);
  scope.snap.subtitleTracks = [correct, { ...correct, id: "8", selected: false }];
  scope.snapRef.current = scope.snap;
  run();
  assert.deepEqual(writes, [], "ambiguous semantic tracks cannot inherit an FPS correction");
  scope.snap.subtitleTracks = [correct];
  scope.snapRef.current = scope.snap;
  run();
  await Promise.resolve();
  run();
  assert.deepEqual(writes, [25]);
  scope.snapRef.current = { subtitleTracks: [] };
  assert.equal(validity?.(), false, "clearing native tracks invalidates a queued correction");
});
