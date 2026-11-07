import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { JSDOM } from "jsdom";
import * as React from "react";
import * as jsx from "react/jsx-runtime";
import { createRoot } from "react-dom/client";

test("manga browse poster tries HTTPS directly and switches to native proxy after image error", async () => {
  const dom = new JSDOM("<div id='app'></div>", { url: "http://localhost" });
  const oldWindow = globalThis.window;
  const oldDocument = globalThis.document;
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperties(dom.window.HTMLImageElement.prototype, {
    complete: { get: () => true, configurable: true },
    // WebView2 can report complete=true while a deferred image has no decoded pixels yet.
    naturalWidth: { get: () => 0, configurable: true },
  });
  const requests = [];
  const settings = { posterQuality: "max", posterEffect: "fade" };
  const mocks = {
    react: React,
    "react/jsx-runtime": jsx,
    "./row": { ScrollRootContext: React.createContext(null) },
    "@/lib/settings": { useSettings: () => ({ settings }) },
    "@/lib/img-size": { qualityMultiplier: () => 0 },
    "@/lib/visibility": { observeWithin: () => () => {}, observeResize: () => () => {} },
    "@/lib/render-cause": { recordRenderCause: () => {}, noteProbe: () => {} },
    "@/lib/remote-image-proxy": {
      useProxiedImageSrc: (url, options) => {
        requests.push({ url, proxy: options.forceProxy });
        return options.forceProxy ? "blob:cached-atsumaru" : url;
      },
    },
  };
  const source = ts.transpileModule(
    readFileSync(new URL("../src/components/poster.tsx", import.meta.url), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } },
  ).outputText;
  const exports = {};
  new Function("require", "exports", source)((name) => mocks[name] ?? {}, exports);
  const root = createRoot(document.querySelector("#app"));
  const url = "https://cdn.atsu.moe/cover.jpeg";
  try {
    await React.act(() =>
      root.render(
        React.createElement(exports.Poster, {
          src: url,
          seed: "manga",
          preferDirect: true,
        }),
      ),
    );
    assert.equal(document.querySelector(".harbor-poster-img").getAttribute("src"), url);
    await React.act(() =>
      document.querySelector(".harbor-poster-img").dispatchEvent(new dom.window.Event("error")),
    );
    assert.equal(
      document.querySelector(".harbor-poster-img").getAttribute("src"),
      "blob:cached-atsumaru",
    );
    assert.ok(requests.some((call) => call.url === url && !call.proxy));
    assert.ok(requests.some((call) => call.url === url && call.proxy));
  } finally {
    await React.act(() => root.unmount());
    dom.window.close();
    globalThis.window = oldWindow;
    globalThis.document = oldDocument;
  }
});
