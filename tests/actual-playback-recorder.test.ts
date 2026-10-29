import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { JSDOM } from "jsdom";
import * as React from "react";
import { createRoot } from "react-dom/client";
import { actualPlaybackSnapshot } from "../src/lib/player/actual-playback";
import { initialPlayerSnapshot } from "../src/lib/player/bridge";
import * as history from "../src/lib/playback-history";

test("actual recorder follows decoded clock activity, ignores buffer updates and stale source frames", async () => {
  const dom = new JSDOM("<!doctype html><div id='app'></div>");
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  let position = 0;
  const clock = new Set<() => void>();
  const writes: any[] = [];
  const dependencies: Record<string, unknown> = {
    react: React,
    "@/lib/playback-history": {
      capturePlaybackActor: () => ({ profileId: "one", storageProfileId: "one", accountId: null }),
      playbackSourceKey: (src: any) => src.url,
      recordActualPlayback: (entry: any) => {
        writes.push(entry);
        return true;
      },
    },
    "@/lib/player/actual-playback": { actualPlaybackSnapshot },
    "@/lib/subtitles/subtitle-memory": {
      readRememberedSub: () => null,
      subtitleMediaKey: () => "fixture",
    },
    "@/lib/player/playback-clock": {
      getPlaybackPosition: () => position,
      subscribePlaybackClock: (fn: () => void) => {
        clock.add(fn);
        return () => clock.delete(fn);
      },
    },
  };
  const text = readFileSync(
    new URL("../src/views/player/hooks/use-actual-playback.ts", import.meta.url),
    "utf8",
  );
  const code = ts.transpileModule(text, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports: any = {};
  new Function("require", "exports", code)((id: string) => {
    if (!(id in dependencies)) throw new Error(id);
    return dependencies[id];
  }, exports);
  function Fixture(props: any) {
    exports.useActualPlayback(props.src, props.snap);
    return null;
  }
  const root = createRoot(document.querySelector("#app")!);
  const source = (name: string) => ({
    meta: { id: "local:same-id", name, type: "movie" },
    title: name,
    url: `C:/fixture/${name}.mp4`,
  });
  const ready = {
    ...initialPlayerSnapshot(),
    status: "playing",
    firstFrameReady: true,
    durationSec: 40,
  };
  const render = async (src: any, snap: any) => {
    await React.act(async () => root.render(React.createElement(Fixture, { src, snap })));
  };
  const tick = async (value: number) => {
    await React.act(async () => {
      position = value;
      clock.forEach((fn) => fn());
    });
  };
  try {
    await render(source("a"), initialPlayerSnapshot());
    await tick(0);
    assert.equal(writes.length, 0);
    await render(source("a"), { ...ready, status: "paused" });
    await tick(2);
    assert.equal(writes.length, 0, "opening and pre-seeking a paused source is not an actual play");
    await render(source("a"), ready);
    await tick(3);
    assert.equal(writes.at(-1)?.src.title, "a");
    const count = writes.length;
    await tick(3);
    assert.equal(writes.length, count);
    await render(source("b"), ready); // previous source's last rendered snapshot
    await tick(3);
    assert.equal(writes.filter((entry) => entry.src.title === "b").length, 0);
    await render(source("b"), initialPlayerSnapshot());
    await tick(0);
    await render(source("b"), ready);
    await tick(1);
    assert.equal(writes.at(-1)?.src.title, "b");
    assert.equal(writes.at(-1)?.positionMs, 1000);
    await render(source("b"), { ...ready, status: "paused", audioDelaySec: 0.1 });
    await render(source("b"), {
      ...ready,
      status: "paused",
      audioDelaySec: 0.7,
      subDelaySec: -1.5,
    });
    await React.act(async () => window.dispatchEvent(new dom.window.Event("beforeunload")));
    assert.equal(writes.at(-1)?.audioDelaySec, 0.7, "refresh captures late paused settings");
    assert.equal(writes.at(-1)?.subDelaySec, -1.5);
  } finally {
    await React.act(async () => root.unmount());
    dom.window.close();
  }
});

test("a live recorder survives a same-owner CW privacy change and ignores obsolete hide flags", async () => {
  const dom = new JSDOM("<!doctype html><div id='app'></div>");
  const values = new Map<string, string>();
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  });
  const profile = (activeId: string) =>
    values.set(
      "harbor.profiles.v1",
      JSON.stringify({
        activeId,
        profiles: [
          { id: "one", isPrimary: true },
          { id: "two", shareStremioWith: "one" },
        ],
      }),
    );
  profile("one");
  values.set("harbor.auth.one", JSON.stringify({ user: { _id: "fixture-account" } }));
  let position = 0;
  const clock = new Set<() => void>();
  const dependencies: Record<string, unknown> = {
    react: React,
    "@/lib/playback-history": history,
    "@/lib/player/actual-playback": { actualPlaybackSnapshot },
    "@/lib/subtitles/subtitle-memory": {
      readRememberedSub: () => null,
      subtitleMediaKey: () => "fixture",
    },
    "@/lib/player/playback-clock": {
      getPlaybackPosition: () => position,
      subscribePlaybackClock: (fn: () => void) => {
        clock.add(fn);
        return () => clock.delete(fn);
      },
    },
  };
  const code = ts.transpileModule(
    readFileSync(
      new URL("../src/views/player/hooks/use-actual-playback.ts", import.meta.url),
      "utf8",
    ),
    {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    },
  ).outputText;
  const exports: any = {};
  new Function("require", "exports", code)((id: string) => {
    assert.ok(id in dependencies, id);
    return dependencies[id];
  }, exports);
  const src = {
    meta: { id: "local:fixture", name: "Fixture", type: "movie" },
    url: "C:/fixture/movie.mp4",
  };
  const ready = {
    ...initialPlayerSnapshot(),
    status: "playing",
    firstFrameReady: true,
    durationSec: 60,
  };
  function Fixture({ snap }: { snap: unknown }) {
    exports.useActualPlayback(src, snap);
    return null;
  }
  const root = createRoot(document.querySelector("#app")!);
  const render = (snap: unknown) =>
    React.act(async () => root.render(React.createElement(Fixture, { snap })));
  const tick = (value: number) =>
    React.act(async () => {
      position = value;
      clock.forEach((listener) => listener());
    });
  try {
    await render(initialPlayerSnapshot());
    await render(ready);
    await tick(3);
    const first = history.readLastActualPlayback()!;
    assert.equal(first.positionMs, 3000);
    values.set("harbor.settings.shared", JSON.stringify({ cwPerProfile: true }));
    await tick(5);
    await render({ ...ready, status: "paused", audioDelaySec: 0.7 });
    const continued = history.readLastActualPlayback()!;
    assert.equal(continued.id, first.id);
    assert.equal(continued.positionMs, 5000);
    assert.equal(continued.audioDelaySec, 0.7);
    const key = "harbor.playback-history.v1.one";
    const stored = JSON.parse(values.get(key)!);
    stored["local:fixture"].dismissedActualId = continued.id;
    stored["local:fixture"].actualByProfile.one.dismissedActualId = continued.id;
    values.set(key, JSON.stringify(stored));
    await render({ ...ready, status: "paused", audioDelaySec: 0.7, subDelaySec: 1.2 });
    assert.equal(history.readLastActualPlayback()?.id, continued.id);
    assert.equal(history.readLastActualPlayback()?.positionMs, 5000);
    assert.equal(history.readActualPlaybackFor(src)?.subDelaySec, 1.2);
    profile("two");
    await render(ready);
    await tick(8);
    await render({ ...ready, status: "paused" });
    assert.equal(
      history.readLastActualPlayback(),
      null,
      "the old recorder cannot claim the sibling profile",
    );
    profile("one");
    assert.equal(history.readActualPlaybackFor(src)?.positionMs, 5000);
    values.set("harbor.account-provider", "nuvio");
    values.set(
      "harbor.nuvio.state.v1",
      JSON.stringify({ activeProfileIndex: 1, session: { user: { id: "fixture-nuvio" } } }),
    );
    await render({ ...ready, status: "paused", subDelaySec: 4 });
    assert.equal(
      history.readLastActualPlayback(),
      null,
      "the old recorder cannot claim another provider",
    );
  } finally {
    await React.act(async () => root.unmount());
    dom.window.close();
  }
});
