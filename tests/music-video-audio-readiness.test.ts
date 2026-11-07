import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import type { MusicTrack } from "../src/lib/music/types";

type AudioReadiness = {
  isMusicTrackPrimed: (track: MusicTrack) => boolean;
  waitForMusicAudioReady: (track: MusicTrack) => Promise<boolean>;
  set: (next: {
    enginePrimed?: boolean;
    audioReady?: {
      id: string;
      connectorId?: string;
      request: number;
      done: Promise<boolean>;
    } | null;
    playRequest?: number;
    phase?: string;
    current?: MusicTrack | null;
  }) => void;
};

function readiness(): AudioReadiness {
  const source = readFileSync(new URL("../src/lib/music/player.ts", import.meta.url), "utf8");
  const tree = ts.createSourceFile("player.ts", source, ts.ScriptTarget.Latest, true);
  const names = new Set(["isMusicTrackPrimed", "waitForMusicAudioReady"]);
  const functions = tree.statements.filter(
    (node) => ts.isFunctionDeclaration(node) && names.has(node.name?.text ?? ""),
  );
  const declarations = `let enginePrimed = false, audioReady = null, playRequest = 0;
    let state = { phase: "idle", current: null };
    exports.set = (next) => {
      if ("enginePrimed" in next) enginePrimed = next.enginePrimed;
      if ("audioReady" in next) audioReady = next.audioReady;
      if ("playRequest" in next) playRequest = next.playRequest;
      if ("phase" in next) state.phase = next.phase;
      if ("current" in next) state.current = next.current;
    };`;
  const output = ts.transpileModule(
    declarations + functions.map((node) => node.getText(tree)).join("\n"),
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } },
  ).outputText;
  const exports: Record<string, unknown> = {};
  new Function("exports", output)(exports);
  return exports as AudioReadiness;
}

const track: MusicTrack = {
  id: "youtube:video",
  connectorId: "youtube",
  title: "Video",
  artist: "Artist",
  artwork: "",
  durationSeconds: 180,
  durationLabel: "3:00",
  mediaKind: "video",
};

test("a reloaded track that the native engine already holds is ready for video", async () => {
  const api = readiness();
  api.set({ enginePrimed: true, phase: "paused", current: track });
  assert.equal(api.isMusicTrackPrimed(track), true);
  assert.equal(await api.waitForMusicAudioReady(track), true);
});

test("a cold start still requires the native audio load", async () => {
  const api = readiness();
  api.set({ enginePrimed: false, phase: "paused", current: track });
  assert.equal(api.isMusicTrackPrimed(track), false);
  assert.equal(await api.waitForMusicAudioReady(track), false);

  let finish!: (ready: boolean) => void;
  const done = new Promise<boolean>((resolve) => {
    finish = resolve;
  });
  api.set({
    audioReady: { id: track.id, connectorId: track.connectorId, request: 1, done },
    playRequest: 1,
    current: track,
    phase: "resolving",
  });
  const ready = api.waitForMusicAudioReady(track);
  finish(true);
  assert.equal(await ready, true);
});
