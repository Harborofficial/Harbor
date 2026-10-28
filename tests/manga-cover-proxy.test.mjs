import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as React from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { createObjectUrlCache } from "../src/lib/object-url-cache.ts";

async function withCoverProxy(
  responses,
  callback,
  auth = undefined,
  coverUrl = "https://cdn.atsu.moe/example.jpg",
  forceProxy = true,
) {
  const dom = new JSDOM("<div id='app'></div>", { url: "http://localhost/" });
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  window.__TAURI_INTERNALS__ = {};
  const calls = [];
  const pool = createObjectUrlCache();
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB";
  const mocks = {
    react: React,
    "./object-url-cache": { createObjectUrlCache: () => pool },
    "@tauri-apps/api/core": {
      invoke: async (name, { args }) => {
        if (name === "cached_thumb_path") return null;
        assert.equal(name, "harbor_fetch");
        calls.push(args);
        const result = responses.shift();
        if (result instanceof Error) throw result;
        if (result === undefined) throw new Error("unexpected extra request");
        return typeof result === "number"
          ? { ok: false, status: result, body: "", contentType: "text/plain" }
          : { ok: true, status: 200, body: png, contentType: "image/png" };
      },
    },
    "@/lib/manga/sources/suwayomi/auth-registry": { suwayomiAuthFor: () => auth },
    "@/lib/settings": { useSettings: () => ({ settings: { posterQuality: "max" } }) },
    "@/lib/idb-cache": { idbCacheKeys: async () => [], idbCacheGet: async () => null },
  };
  const compiled = ts.transpileModule(
    readFileSync(new URL("../src/lib/remote-image-proxy.ts", import.meta.url), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  const exported = {};
  new Function("require", "exports", compiled)((name) => {
    assert.ok(name in mocks, "unexpected module " + name);
    return mocks[name];
  }, exported);
  let resolved;
  function View() {
    resolved = exported.useProxiedImageSrc(coverUrl, {
      forceProxy,
      persistent: true,
      originalSize: true,
    });
    return null;
  }
  const root = createRoot(document.querySelector("#app"));
  try {
    await React.act(async () => {
      root.render(React.createElement(View));
    });
    await callback({ calls, resolved });
  } finally {
    await React.act(() => root.unmount());
    pool.clear();
    dom.window.close();
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
  }
}

test("grid poster retries HTTP 400 once without persistent cache headers", async () => {
  await withCoverProxy([400, "image"], ({ calls, resolved }) => {
    assert.equal(calls.length, 2);
    assert.equal(calls[0].cacheImage, true);
    assert.equal(calls[1].cacheImage, false);
    assert.equal(calls[1].headers.Accept, "image/*");
    assert.equal(calls[0].url, calls[1].url);
    assert.match(resolved, /^blob:/);
  });
});

test("successful cached covers do not make additional requests", async () => {
  await withCoverProxy(["image"], ({ calls, resolved }) => {
    assert.equal(calls.length, 1);
    assert.equal(calls[0].cacheImage, true);
    assert.match(resolved, /^blob:/);
  });
});

test("credentialed image requests never silently retry without their credentials", async () => {
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    await withCoverProxy(
      [400],
      ({ calls }) => {
        assert.equal(calls.length, 1);
        assert.equal(calls[0].headers.authorization, "Basic abc");
      },
      "Basic abc",
    );
  } finally {
    console.warn = originalWarn;
  }
});

test("Mangapill CDN covers use the native proxy with the source site's Referer", async () => {
  const coverUrl = "https://cdn.readdetectiveconan.com/file/mangap/158/10011000/10.jpg";
  await withCoverProxy(
    ["image"],
    ({ calls, resolved }) => {
      assert.equal(calls.length, 1);
      assert.equal(calls[0].url, coverUrl);
      assert.equal(calls[0].headers.Referer, "https://mangapill.com/");
      assert.match(resolved, /^blob:/);
    },
    undefined,
    coverUrl,
    false,
  );
});

test("unrelated image hosts do not receive Mangapill's Referer", async () => {
  await withCoverProxy(
    ["image"],
    ({ calls }) => {
      assert.equal(calls.length, 1);
      assert.equal(calls[0].headers, undefined);
    },
    undefined,
    "https://cdn.readdetectiveconan.com.other.example/cover.jpg",
  );
});
