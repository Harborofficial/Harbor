import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { JSDOM } from "jsdom";
import * as React from "react";
import * as jsx from "react/jsx-runtime";
import { createRoot } from "react-dom/client";

test("cursor sharing does no page geometry work when idle and keeps joined sending functional", async () => {
  const dom = new JSDOM("<main></main><div id='app'></div>", { pretendToBeVisual: true });
  const previous = { window: globalThis.window, document: globalThis.document };
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  let reads = 0;
  const main = document.querySelector("main");
  main.getBoundingClientRect = () => {
    reads++;
    return { left: 0, top: 0, width: 1000, height: 800 };
  };
  Object.defineProperties(main, {
    scrollHeight: { get: () => 2000 },
    clientHeight: { get: () => 800 },
  });
  main.style.overflowY = "auto";
  const snapshot = { state: "idle", participants: [] };
  const settings = { togetherShareCursors: true };
  const sent = [];
  const sendCursor = (...args) => sent.push(args);
  let path = "home";
  const mocks = {
    react: React,
    "react/jsx-runtime": jsx,
    "@/lib/together/provider": {
      useTogether: () => ({ snapshot, sendCursor, remoteCursors: [], clientId: "self" }),
    },
    "@/lib/settings": { useSettings: () => ({ settings }) },
    "@/lib/view": { useView: () => ({ chromeHidden: false, topPath: path }) },
  };
  const code = ts.transpileModule(
    readFileSync(new URL("../src/components/together-cursors.tsx", import.meta.url), "utf8"),
    {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    },
  ).outputText;
  const exports = {};
  new Function("require", "exports", code)((name) => mocks[name], exports);
  const root = createRoot(document.querySelector("#app"));
  try {
    const render = () => root.render(React.createElement(exports.TogetherCursors));
    await React.act(render);
    path = "discover";
    await React.act(render);
    await React.act(() => main.dispatchEvent(new dom.window.Event("scroll")));
    assert.equal(reads, 0, "ordinary browsing must not scan watch-party cursor geometry");
    snapshot.state = "joined";
    await React.act(render);
    assert.ok(reads > 0);
    await React.act(() =>
      window.dispatchEvent(new dom.window.MouseEvent("mousemove", { clientX: 200, clientY: 100 })),
    );
    assert.ok(sent.some((args) => args[2] === true && args[3] === "discover"));
    settings.togetherShareCursors = false;
    await React.act(render);
    const before = reads;
    path = "home";
    await React.act(render);
    await React.act(() => main.dispatchEvent(new dom.window.Event("scroll")));
    assert.equal(reads, before);
  } finally {
    await React.act(() => root.unmount());
    dom.window.close();
    Object.assign(globalThis, previous);
  }
});
