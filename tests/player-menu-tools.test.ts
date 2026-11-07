import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { parseMagnet } from "../src/lib/torrent/magnet.ts";
import { magnetFromHash } from "../src/lib/debrid/types.ts";

function load(path: string, dependencies: Record<string, unknown>) {
  const code = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const output: any = {};
  new Function("require", "exports", code)((id: string) => {
    if (!(id in dependencies)) throw new Error(id);
    return dependencies[id];
  }, output);
  return output;
}

test("player magnet uses only a supported active-source hash or magnet", () => {
  const actions = load("src/lib/player-actions.ts", {
    react: React,
    "./torrent/magnet": { parseMagnet },
    "./debrid/types": { magnetFromHash },
  });
  const hash = "0123456789abcdef0123456789abcdef01234567";
  assert.equal(actions.playerMagnetUrl(hash), `magnet:?xt=urn:btih:${hash}`);
  assert.equal(
    actions.playerMagnetUrl(`magnet:?xt=urn:btih:${hash}&tr=https://tracker.invalid`),
    `magnet:?xt=urn:btih:${hash}&tr=https://tracker.invalid`,
  );
  for (const invalid of [
    null,
    "",
    "not-a-hash",
    "https://stream.invalid/video.mp4",
    "magnet:?dn=no-hash",
  ])
    assert.equal(actions.playerMagnetUrl(invalid), null);
});

test("published player tools refresh after source and subtitle capability changes", () => {
  const actions = load("src/lib/player-actions.ts", {
    react: React,
    "./torrent/magnet": { parseMagnet },
    "./debrid/types": { magnetFromHash },
  });
  const first = {
    download() {},
    toggleFullscreen() {},
    canDownload: true,
    downloadSubtitle() {},
    canDownloadSubtitle: true,
    streamUrl: "a",
    infoHash: null,
    magnetUrl: "magnet:a",
    liveSync() {},
    canLiveSync: true,
  };
  actions.setPlayerActions(first);
  actions.setPlayerActions({ ...first, magnetUrl: null, canLiveSync: false });
  assert.equal(actions.currentPlayerActions().magnetUrl, null);
  assert.equal(actions.currentPlayerActions().canLiveSync, false);
  actions.setPlayerActions(null);
  assert.equal(actions.currentPlayerActions(), null);
});

test("player menu keeps magnet as a normal row with subtitle and stream tools and no quick strip", async () => {
  const copied: string[] = [];
  const opened: string[] = [];
  let synced = 0;
  let current: any = {
    streamUrl: "https://media.invalid/a",
    magnetUrl: "magnet:a",
    canDownload: true,
    canDownloadSubtitle: true,
    canLiveSync: true,
    download() {},
    downloadSubtitle() {},
    toggleFullscreen() {},
    liveSync() {
      synced++;
    },
  };
  const icons = Object.fromEntries(
    ["AudioLines", "Download", "ExternalLink", "Link2", "Magnet", "Maximize"].map((key) => [
      key,
      () => null,
    ]),
  );
  const { playerContextSources } = load("src/components/context-menu/player-actions.tsx", {
    "react/jsx-runtime": jsxRuntime,
    "lucide-react": icons,
    "@/lib/i18n": { t: (text: string) => text },
    "./content-actions": {
      copyContextText: async (text: string) => {
        copied.push(text);
      },
    },
    "@/lib/social/link-out": {
      openLinkOut: async (url: string) => {
        opened.push(url);
      },
    },
  });
  const source = playerContextSources(() => current);
  assert.equal(source.quick, undefined, "item menus do not provide an empty or populated strip");
  assert.deepEqual(
    source.rows.actions().map((a: any) => a.label),
    [
      "Full screen",
      "Download Video",
      "Download Subtitle",
      "Live sync",
      "Copy stream link",
      "Open in browser",
      "Copy magnet",
    ],
  );
  assert.equal(
    source.rows.actions().some((a: any) => /Settings|Back|Resume/.test(a.label)),
    false,
  );
  const magnet = source.rows.actions().find((a: any) => a.label === "Copy magnet");
  assert.equal(magnet.group, "links", "magnet shares the ordinary link command group");
  await magnet.run();
  assert.deepEqual(copied, ["magnet:a"]);
  current = {
    ...current,
    streamUrl: "https://media.invalid/b",
    magnetUrl: null,
    canLiveSync: false,
  };
  assert.equal(
    source.rows.actions().some((a: any) => a.label === "Copy magnet"),
    false,
  );
  const live = source.rows.actions().find((a: any) => a.label === "Live sync");
  assert.equal(live.disabled, true);
  assert.equal(live.reason, "Select a subtitle track first.");
  assert.equal(synced, 0);
  await source.rows
    .actions()
    .find((a: any) => a.label === "Copy stream link")
    .run();
  await source.rows
    .actions()
    .find((a: any) => a.label === "Open in browser")
    .run();
  assert.equal(copied[1], "https://media.invalid/b");
  assert.deepEqual(opened, ["https://media.invalid/b"]);
  current = null;
  assert.equal(source.rows.isValid(), false);
  assert.deepEqual(source.rows.actions(), []);
});

test("player rows preserve available commands without adding application navigation", async () => {
  const calls: string[] = [];
  let current: any = {
    toggleFullscreen: () => calls.push("fullscreen"),
    download: () => calls.push("video"),
    downloadSubtitle: () => calls.push("subtitle"),
    liveSync: () => calls.push("sync"),
    canDownload: true,
    canDownloadSubtitle: true,
    canLiveSync: true,
    streamUrl: "file:///disposable-fixture/video.mp4",
  };
  const icons = Object.fromEntries(
    ["AudioLines", "Download", "ExternalLink", "Link2", "Magnet", "Maximize"].map((key) => [
      key,
      () => null,
    ]),
  );
  const { playerContextSources } = load("src/components/context-menu/player-actions.tsx", {
    "react/jsx-runtime": jsxRuntime,
    "lucide-react": icons,
    "@/lib/i18n": { t: (text: string) => text },
    "./content-actions": { copyContextText: async () => {} },
    "@/lib/social/link-out": { openLinkOut: async () => {} },
  });
  const source = playerContextSources(() => current);
  assert.equal(source.quick, undefined);
  assert.deepEqual(
    source.rows.actions().map((action: any) => action.label),
    ["Full screen", "Download Video", "Download Subtitle", "Live sync"],
  );
  for (const action of source.rows.actions()) await action.run();
  assert.deepEqual(calls, ["fullscreen", "video", "subtitle", "sync"]);
  current = { ...current, canDownload: false, canDownloadSubtitle: false, liveSync: undefined };
  assert.deepEqual(
    source.rows.actions().map((action: any) => action.label),
    ["Full screen"],
  );
});
