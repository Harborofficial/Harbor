import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { JSDOM } from "jsdom";
import * as React from "react";
import { createRoot } from "react-dom/client";
import * as audioChoice from "../src/lib/player/audio-choice";
import * as playbackHistory from "../src/lib/playback-history";
import * as continuation from "../src/lib/player/continue-playback";
import * as subtitleChoice from "../src/lib/player/subtitle-choice";
import * as language from "../src/lib/subtitles/language";
import { initialPlayerSnapshot, type TrackInfo } from "../src/lib/player/bridge";

const tracks: TrackInfo[] = [
  {
    id: "1",
    kind: "audio",
    lang: "eng",
    title: "Original",
    label: "Original",
    codec: "AAC (ADVANCED AUDIO CODING)",
    channels: "stereo",
    channelCount: 2,
    selected: true,
  },
  {
    id: "2",
    kind: "audio",
    lang: "ara",
    title: "Commentary",
    label: "Commentary",
    codec: "AAC (ADVANCED AUDIO CODING)",
    channels: "stereo",
    channelCount: 2,
    selected: false,
  },
];
const saved = audioChoice.playbackAudioChoice(tracks[1]);

async function fixture(remembered = true) {
  const dom = new JSDOM("<!doctype html><div id='root'></div>");
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const calls: string[] = [];
  const errors: string[] = [];
  const bridgeRef = {
    current: {
      setAudioTrack: (id: string) => {
        calls.push(id);
      },
      setAudioNormalize() {},
      setAudioProfile() {},
      setAudioDevice() {},
      setSubDelay() {},
      setSubtitleTrack() {},
    },
  };
  const dependencies: Record<string, unknown> = {
    react: React,
    "@tauri-apps/api/core": {
      invoke: () => {
        throw new Error("Unexpected native request");
      },
    },
    "@/lib/subtitles/language": language,
    "@/lib/subtitles/fetch-into-player": {},
    "@/lib/subtitles/provider-label": { subtitleStreamDescriptor: () => null },
    "@/components/player/subtitle-menu/subtitle-search-store": { publishSubtitleSearch() {} },
    "@/components/player/subtitle-menu/subtitle-context-store": { publishSubtitleContext() {} },
    "@/lib/player-prefs": { readPlayerPrefs: () => ({ audioLang: "eng", subsOff: true }) },
    "@/lib/playback-history": {
      ...playbackHistory,
      readActualPlaybackFor: () => null,
    },
    "@/lib/player/audio-choice": audioChoice,
    "@/lib/player/continue-playback": continuation,
    "@/lib/player/subtitle-choice": subtitleChoice,
    "@/components/lists/list-toast": {
      emitListToast: (message: string) => errors.push(message),
    },
    "@/lib/i18n": { t: (message: string) => message },
    "@/lib/player/mpv-properties": {},
    "@/lib/providers/tmdb": {},
    "@/lib/subtitles/addon-source": { gatherSubtitleAddons: async () => [] },
    "@/lib/streams/stream-ids": { buildStreamIds: () => [] },
    "@/lib/subtitles/autoload": {
      canStartSubtitleAutoload: () => false,
      subtitleSearchImdbId: () => null,
    },
    "@/lib/subtitles/autoload-run": {
      SubtitleAutoloadRunCoordinator: class {
        invalidate() {}
      },
    },
    "@/lib/subtitles/anime-numbering": {},
    "@/lib/subtitles/track-selection": { subtitleAutoSelectionSignature: () => "empty" },
    "@/lib/subtitles/added-subs": {},
    "@/lib/player/imported-subs": {},
    "@/lib/subtitles/provider-auth": {},
    "@/lib/subtitles/subtitle-memory": {
      readRememberedSub: () => null,
      subtitleMediaKey: () => "fixture",
      rememberedSubAppliesToStream: () => false,
    },
  };
  const source = readFileSync(
    new URL("../src/views/player/hooks/use-track-autoload.ts", import.meta.url),
    "utf8",
  );
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports: any = {};
  new Function("require", "exports", code)((id: string) => {
    assert.ok(id in dependencies, `Unexpected module ${id}`);
    return dependencies[id];
  }, exports);
  const src = {
    url: "C:/synthetic/audio.mkv",
    meta: { id: "local:fixture", type: "movie", name: "Fixture" },
    continuation: remembered
      ? {
          sourceKey: "C:/synthetic/audio.mkv",
          actor: playbackHistory.capturePlaybackActor(),
          audioTrack: saved,
        }
      : undefined,
  };
  const settings = {
    preferredAudioLangs: ["English"],
    preferredSubLangs: ["English"],
    trackBlockWords: ["commentary"],
    subProvidersEnabled: { addons: false },
    audioNormalize: false,
    audioProfile: "off",
  };
  function Fixture({
    audioTracks,
    firstFrameReady,
  }: {
    audioTracks: TrackInfo[];
    firstFrameReady: boolean;
  }) {
    exports.useTrackAutoload({
      bridgeRef,
      src,
      settings,
      engine: "mpv",
      authKey: null,
      snap: { ...initialPlayerSnapshot(), durationSec: 360, audioTracks, firstFrameReady },
    });
    return null;
  }
  const root = createRoot(document.getElementById("root")!);
  const render = async (audioTracks: TrackInfo[], firstFrameReady = false) =>
    React.act(async () =>
      root.render(React.createElement(Fixture, { audioTracks, firstFrameReady })),
    );
  const dispose = async () => {
    await React.act(async () => root.unmount());
    dom.window.close();
  };
  return { render, dispose, calls, errors };
}

test("an exact remembered Commentary choice overrides automatic block words", async () => {
  const f = await fixture();
  try {
    await f.render(tracks);
    assert.deepEqual(f.calls, ["2"]);
  } finally {
    await f.dispose();
  }
});

test("native inactive Commentary restores before decoder enrichment from AAC unknown2 to stereo", async () => {
  const f = await fixture();
  try {
    await f.render(
      tracks.map((track) =>
        track.id === "2" ? { ...track, codec: "AAC", channels: "unknown2" } : track,
      ),
    );
    assert.deepEqual(f.calls, ["2"]);
    await f.render(tracks.map((track) => ({ ...track, selected: track.id === "2" })));
    assert.deepEqual(f.calls, ["2"]);
  } finally {
    await f.dispose();
  }
});

test("automatic fallback still respects commentary filtering without an exact choice", async () => {
  const f = await fixture(false);
  try {
    await f.render(tracks.map((track) => ({ ...track, selected: track.id === "2" })));
    assert.deepEqual(f.calls, ["1"]);
  } finally {
    await f.dispose();
  }
});

test("late semantic track metadata retries exact restoration even when IDs do not change", async () => {
  const f = await fixture();
  try {
    await f.render(tracks.map((track) => ({ ...track, title: undefined, label: undefined })));
    assert.deepEqual(f.calls, []);
    await f.render(tracks);
    assert.deepEqual(f.calls, ["2"]);
  } finally {
    await f.dispose();
  }
});

test("late metadata cannot overwrite a newer manual audio selection", async () => {
  const f = await fixture();
  try {
    const third = {
      ...tracks[0],
      id: "3",
      lang: "fra",
      title: "French",
      label: "French",
      selected: false,
    };
    await f.render([
      ...tracks.map((track) => ({ ...track, title: undefined, label: undefined })),
      third,
    ]);
    assert.deepEqual(f.calls, []);
    await f.render([...tracks, third].map((track) => ({ ...track, selected: track.id === "3" })));
    assert.deepEqual(f.calls, []);
  } finally {
    await f.dispose();
  }
});

test("reordered numeric IDs restore the remembered semantic audio track", async () => {
  const f = await fixture();
  try {
    await f.render(tracks.map((track) => ({ ...track, id: track.id === "1" ? "2" : "1" })));
    assert.deepEqual(f.calls, ["1"]);
    assert.deepEqual(f.errors, []);
  } finally {
    await f.dispose();
  }
});

test("unavailable remembered audio reports once after decoding, without claiming restoration", async () => {
  const f = await fixture();
  try {
    await f.render([tracks[0]]);
    assert.deepEqual(f.errors, []);
    await f.render([tracks[0]], true);
    await f.render([tracks[0]], true);
    assert.deepEqual(f.calls, []);
    assert.deepEqual(f.errors, [
      "The saved audio track could not be restored. Choose an audio track.",
    ]);
  } finally {
    await f.dispose();
  }
});
