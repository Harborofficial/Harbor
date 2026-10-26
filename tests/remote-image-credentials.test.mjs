import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as React from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { createObjectUrlCache } from "../src/lib/object-url-cache.ts";

test("changing credentials at the same image URL fetches a replacement and releases the old lease", async () => {
  const dom = new JSDOM("<div id='app'></div>", { url: "http://localhost/" });
  const oldWindow = globalThis.window;
  const oldDocument = globalThis.document;
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  window.__TAURI_INTERNALS__ = {};
  let auth = "Basic first";
  let resolved;
  const calls = [];
  const pool = createObjectUrlCache();
  const dependencies = {
    react: React,
    "./object-url-cache": { createObjectUrlCache: () => pool },
    "@tauri-apps/api/core": {
      invoke: async (_command, { args }) => {
        calls.push(args.headers.authorization);
        return { ok: true, status: 200, body: "iVBORw0KGgo=", contentType: "image/png" };
      },
    },
    "@/lib/manga/sources/suwayomi/auth-registry": { suwayomiAuthFor: () => auth },
    "@/lib/settings": { useSettings: () => ({ settings: { posterQuality: "max" } }) },
    "@/lib/idb-cache": {},
  };
  const exports = {};
  const code = ts.transpileModule(
    readFileSync(new URL("../src/lib/remote-image-proxy.ts", import.meta.url), "utf8"),
    {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    },
  ).outputText;
  new Function("require", "exports", code)((name) => dependencies[name], exports);
  function View() {
    resolved = exports.useProxiedImageSrc("https://example.com/cover.png");
    return null;
  }
  const root = createRoot(document.querySelector("#app"));
  try {
    await React.act(async () => {
      root.render(React.createElement(View, { iteration: 0 }));
    });
    const first = resolved;
    assert.ok(first);
    auth = "Basic second";
    await React.act(async () => {
      root.render(React.createElement(View, { iteration: 1 }));
    });
    assert.ok(resolved);
    assert.notEqual(resolved, first);
    assert.deepEqual(calls, ["Basic first", "Basic second"]);
    await React.act(() => root.unmount());
    pool.clear();
    assert.deepEqual(pool.stats(), { bytes: 0, entries: 0 });
  } finally {
    await React.act(() => root.unmount());
    pool.clear();
    dom.window.close();
    globalThis.window = oldWindow;
    globalThis.document = oldDocument;
  }
});
