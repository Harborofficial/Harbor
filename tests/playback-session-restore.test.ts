import assert from "node:assert/strict";
import test from "node:test";
import { restoreHarness } from "./helpers/subtitle-memory-harness";
import { playbackSubtitleChoice } from "../src/lib/player/subtitle-choice";
import type { TrackInfo } from "../src/lib/player/bridge";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { selectPlaybackAudio } from "../src/lib/player/audio-choice";
import { selectedSubtitleCacheName } from "../src/lib/subtitles/selected-subtitle-cache";
import { rememberedFromChoice } from "../src/lib/subtitles/subtitle-memory";

const embedded = (id: string, title: string): TrackInfo => ({
  id,
  kind: "subtitle",
  label: title,
  title,
  lang: "ara",
  selected: false,
  codec: "ass",
});

test("a fresh subtitle preselection wins over recalled history or continuation subtitle intent", () => {
  const source = readFileSync(
    new URL("../src/views/player/hooks/use-track-autoload.ts", import.meta.url),
    "utf8",
  );
  const ast = ts.createSourceFile("autoload.ts", source, ts.ScriptTarget.Latest, true);
  let recall: ts.Node | undefined;
  let preselect: ts.Node | undefined;
  const visit = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(ast) === "rememberedSession" &&
      node.initializer &&
      ts.isCallExpression(node.initializer)
    )
      recall = node.initializer.arguments[0];
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(ast) === "useEffect" &&
      node.arguments[0]?.getText(ast).includes("const choice = src.subtitlePreselect;")
    )
      preselect = node.arguments[0];
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.ok(recall);
  assert.ok(preselect);
  const compile = (callback: ts.Node) =>
    ts.transpileModule(`const effect = ${callback.getText(ast)};`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText;
  const recallCode = compile(recall);
  const preselectCode = compile(preselect);

  for (const fromContinuation of [false, true]) {
    for (const choice of [{ off: true }, { url: "https://fixture.invalid/new.srt" }]) {
      const session = {
        subtitle: playbackSubtitleChoice(embedded("1", "Old Arabic")),
        audioTrack: { lang: "eng" },
        subDelaySec: 2,
        audioDelaySec: 0.5,
      };
      const h = restoreHarness({ updatedAt: 1 }, [embedded("9", "Old Arabic")]);
      Object.assign(h.scope.src, {
        subtitlePreselect: choice,
        ...(fromContinuation ? { continuation: { ...session, actor: {} } } : {}),
      });
      const rememberedSession = new Function(
        "src",
        "continuationAppliesToSource",
        "isPlaybackActorCurrent",
        "readActualPlaybackFor",
        `${recallCode}\nreturn effect();`,
      )(
        h.scope.src,
        () => true,
        () => true,
        () => session,
      );
      Object.assign(h.scope, {
        rememberedSession,
        preselectAppliedRef: { current: null },
        markAddedSub() {},
      });
      h.run();
      assert.deepEqual(h.picks, [], "recalled subtitle must not replace the new selection");
      new Function(...Object.keys(h.scope), `${preselectCode}\nreturn effect();`)(
        ...Object.values(h.scope),
      );
      if ("off" in choice) assert.deepEqual(h.picks, [null]);
      else assert.deepEqual(h.adds, [choice.url]);
      assert.deepEqual(rememberedSession.audioTrack, session.audioTrack);
      assert.equal(rememberedSession.subDelaySec, 2);
      assert.equal(rememberedSession.audioDelaySec, 0.5);
    }
  }
});

test("the real restore effect uses scoped continuation subtitle intent ahead of unrelated subtitle memory", () => {
  const selected = embedded("1", "Full dialogue");
  const h = restoreHarness({ off: true, updatedAt: 1 }, [
    embedded("1", "Signs"),
    embedded("9", "Full dialogue"),
  ]);
  Object.assign(h.scope, {
    rememberedSession: { subtitle: playbackSubtitleChoice(selected) },
    embeddedRestoreRef: { current: null },
  });
  h.run();
  assert.deepEqual(h.picks, ["9"]);
});

test("scoped off selection stays off even when a prior subtitle memory would select a subtitle", () => {
  const h = restoreHarness({ source: "https://fixture.invalid/a.srt", updatedAt: 1 }, [
    { ...embedded("3", "Arabic"), selected: true },
  ]);
  Object.assign(h.scope, { rememberedSession: { subtitle: { off: true } } });
  h.run();
  assert.deepEqual(h.picks, [null]);
  assert.deepEqual(h.adds, []);
});

test("late subtitle preparation cannot mutate the player after its account changes", async () => {
  const h = restoreHarness(
    { source: "C:/fixture/a.srt", imported: true, streamKey: "torrent:fixture:0", updatedAt: 1 },
    [],
  );
  let current = true;
  let release!: () => void;
  Object.assign(h.scope, {
    isPlaybackActorCurrent: () => current,
    playbackActor: {},
    bindSubtitleDownloadAuth: () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  });
  h.run();
  current = false;
  release();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(h.adds, []);
});

test("failure to reopen the saved local subtitle reports incomplete restoration", async () => {
  const h = restoreHarness(
    {
      source: "C:/fixture/missing.srt",
      imported: true,
      streamKey: "torrent:fixture:0",
      updatedAt: 1,
    },
    [],
  );
  const errors: string[] = [];
  Object.assign(h.scope, {
    rememberedSession: {
      subtitle: {
        source: "C:/fixture/missing.srt",
        imported: true,
        streamKey: "torrent:fixture:0",
      },
    },
    emitListToast: (message: string) => errors.push(message),
    bindSubtitleDownloadAuth: async () => {
      throw new Error("Unavailable subtitle");
    },
  });
  h.run();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(errors, ["The saved subtitle could not be restored. Choose a subtitle."]);
});

test("a missing embedded subtitle is not silently replaced by a different default track", () => {
  const h = restoreHarness({ updatedAt: 1 }, [
    { ...embedded("1", "Different translation"), selected: true },
  ]);
  const errors: string[] = [];
  Object.assign(h.scope, {
    rememberedSession: { subtitle: playbackSubtitleChoice(embedded("1", "Intended translation")) },
    snap: { ...h.scope.snap, firstFrameReady: true },
    emitListToast: (message: string) => errors.push(message),
  });
  h.run();
  assert.deepEqual(h.picks, [null]);
  assert.deepEqual(errors, ["The saved subtitle could not be restored. Choose a subtitle."]);
});

test("an embedded subtitle missing from an empty ready track list reports once without a premature loading error", () => {
  const h = restoreHarness({ updatedAt: 1 }, []);
  const errors: string[] = [];
  Object.assign(h.scope, {
    rememberedSession: { subtitle: playbackSubtitleChoice(embedded("1", "Intended translation")) },
    emitListToast: (message: string) => errors.push(message),
  });
  h.run();
  assert.deepEqual(errors, []);
  h.scope.snap.firstFrameReady = true;
  h.run();
  h.run();
  assert.deepEqual(errors, ["The saved subtitle could not be restored. Choose a subtitle."]);
});

function latePreplayCacheFixture() {
  const track = {
    ...embedded("9", "Arabic"),
    external: true,
    url: "https://fixture.invalid/chosen.srt",
    subId: "chosen",
    provider: "Fixture provider",
  };
  const streamKey = "torrent:fixture:0";
  const saved = { ...rememberedFromChoice(track), external: true, streamKey, fpsOverride: 25 };
  const filename = selectedSubtitleCacheName(
    "fixture||",
    streamKey,
    { ...track, source: track.url },
    "srt",
  );
  const cached = {
    ...saved,
    source: `C:/fixture/selected/${filename}`,
    format: "srt" as const,
    imported: true,
    updatedAt: Date.now(),
  };
  return { saved, cached };
}

test("reopening uses a proven late pre-play cache even when the scoped actual snapshot still has its remote source", async () => {
  const { saved, cached } = latePreplayCacheFixture();
  const h = restoreHarness(cached, []);
  Object.assign(h.scope, { rememberedSession: { subtitle: saved } });
  h.run();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(h.adds, [cached.source]);
  assert.deepEqual(h.timers, []);
});

test("late cache preference does not cross a different stream, unrelated cached file, or stale actor", async () => {
  const { saved, cached } = latePreplayCacheFixture();
  for (const change of ["stream", "file", "actor"] as const) {
    const memory =
      change === "stream"
        ? { ...cached, streamKey: "torrent:other:0" }
        : change === "file"
          ? { ...cached, source: "C:/fixture/selected/unrelated.srt" }
          : cached;
    const h = restoreHarness(memory, []);
    Object.assign(h.scope, { rememberedSession: { subtitle: saved } });
    if (change === "actor") {
      const stale = {};
      Object.assign(h.scope.src, { continuation: { actor: stale } });
      Object.assign(h.scope, { isPlaybackActorCurrent: (actor: unknown) => actor !== stale });
    }
    h.run();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(h.adds.includes(memory.source), false, change);
  }
});

test("unavailable remembered audio produces honest one-time feedback after decoding", () => {
  const source = readFileSync(
    new URL("../src/views/player/hooks/use-track-autoload.ts", import.meta.url),
    "utf8",
  );
  const ast = ts.createSourceFile("autoload.ts", source, ts.ScriptTarget.Latest, true);
  let effect: ts.Node | undefined;
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(ast) === "useEffect" &&
      node.arguments[0]?.getText(ast).includes("The saved audio track could not be restored.")
    )
      effect = node.arguments[0];
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.ok(effect);
  const compiled = ts.transpileModule(`const effect = ${effect.getText(ast)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const errors: string[] = [];
  const scope = {
    rememberedAudio: { id: "1", lang: "ara", title: "Arabic" },
    src: { url: "fixture.mkv" },
    snap: {
      firstFrameReady: false,
      audioTracks: [
        { id: "1", kind: "audio", selected: true, title: "English", label: "English", lang: "eng" },
      ],
    },
    selectPlaybackAudio,
    audioRestoreWarningRef: { current: null },
    autoAudioIdRef: { current: "1" },
    emitListToast: (message: string) => errors.push(message),
    t: (key: string) => key,
  };
  const run = () =>
    new Function(...Object.keys(scope), `${compiled}\nreturn effect();`)(...Object.values(scope));
  run();
  assert.deepEqual(errors, []);
  scope.snap.firstFrameReady = true;
  run();
  run();
  assert.deepEqual(errors, ["The saved audio track could not be restored. Choose an audio track."]);
});
