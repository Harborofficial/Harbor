import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function evaluate(source: string, resolve: (name: string) => unknown, window: object = {}) {
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports: Record<string, any> = {};
  new Function("require", "exports", "window", js)(resolve, exports, window);
  return exports;
}

test("a loaded paused music session returns after video releases SMTC ownership", async () => {
  const owner = evaluate(
    readFileSync(new URL("../src/lib/player/media-key-owner.ts", import.meta.url), "utf8"),
    (name) => { throw Error(name); },
  );
  const published: Array<{ kind: string; args?: any[] }> = [];
  const media = {
    updateMediaControls: (...args: any[]) => published.push({ kind: "update", args }),
    clearMediaControls: () => published.push({ kind: "clear" }),
    mediaKeyGate: () => true,
  };
  const track = { title: "Paused song", artist: "Singer", album: "Album", artwork: "https://example.com/art.jpg" };
  const state = { current: track, phase: "paused", duration: 200, currentTime: 35, volume: 0.7, likedIds: [] };
  const controls = evaluate(
    readFileSync(new URL("../src/lib/music/taskbar-buttons.ts", import.meta.url), "utf8"),
    (name) => {
      if (name === "@tauri-apps/api/core") return { invoke: async () => {} };
      if (name === "@tauri-apps/api/event") return { listen: async () => () => {} };
      if (name === "./liked") return { isMusicLiked: () => false };
      if (name === "./window-title") return { setMusicWindowTitle: () => {} };
      if (name === "@/lib/media-session") return media;
      if (name === "@/lib/player/media-key-owner") return owner;
      if (name === "./player") return {
        getMusicState: () => state, subscribeMusic: () => () => {},
      };
      throw Error(name);
    },
    { __TAURI_INTERNALS__: {} },
  );

  owner.setVideoOwnsMediaKeys(true);
  const stop = controls.startMusicTaskbarButtons();
  assert.equal(published.length, 0, "video retains ownership while mounted");

  owner.setVideoOwnsMediaKeys(false);
  media.clearMediaControls(); // Video's unmount cleanup can run after ownership is released.
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(published.map((call) => call.kind), ["clear", "update"]);
  assert.equal(published[1].args?.[0], false, "restore the paused, not playing, state");
  assert.equal(published[1].args?.[1], "Paused song");
  assert.equal(published[1].args?.[7], "music");
  assert.equal(published[1].args?.[8], "Album");

  stop();
  assert.equal(published.at(-1)?.kind, "clear");
  owner.setVideoOwnsMediaKeys(true);
  owner.setVideoOwnsMediaKeys(false);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(published.at(-1)?.kind, "clear", "stopped music subscription cannot republish");
});
