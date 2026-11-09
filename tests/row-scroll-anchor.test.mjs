import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { JSDOM } from "jsdom";
import * as React from "react";
import * as jsx from "react/jsx-runtime";
import { createRoot } from "react-dom/client";

test("row resets its horizontal position when its anchored head changes", async () => {
  const dom = new JSDOM("<div id='app'></div>", {
    url: "http://localhost/",
    pretendToBeVisual: true,
  });
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    cancelAnimationFrame: globalThis.cancelAnimationFrame,
  };
  const frames = new Map();
  let next = 0;
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
    requestAnimationFrame: (fn) => {
      frames.set(++next, fn);
      return next;
    },
    cancelAnimationFrame: (id) => frames.delete(id),
  });
  const remembered = [];
  const settings = {
    posterScale: 1,
    rowTitleScale: 1,
    rowCardStyle: "poster",
    posterBackdropExpansion: false,
    posterDockMagnification: false,
  };
  const mocks = {
    react: React,
    "react/jsx-runtime": jsx,
    "@/lib/poster-dock": { resetPosterDock: () => {}, updatePosterDock: () => {} },
    "@/lib/visibility": {
      observeResize: () => () => {},
      observeWithin: () => () => {},
    },
    "@/lib/settings": { useSettings: () => ({ settings }) },
    "@/lib/i18n": { useT: () => (s) => s, useUiLanguage: () => "en", isRtl: () => false },
    "@/lib/view": {
      useViewActions: () => ({
        rememberRowScroll: (key, value) => remembered.push([key, value]),
        recallRowScroll: () => null,
      }),
    },
    "lucide-react": { ChevronLeft: () => null, ChevronRight: () => null },
    "./nav-arrow": { NavChevron: () => null },
  };
  const code = ts.transpileModule(
    readFileSync(new URL("../src/components/row.tsx", import.meta.url), "utf8"),
    {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    },
  ).outputText;
  const exports = {};
  new Function("require", "exports", code)((name) => mocks[name] ?? {}, exports);
  const root = createRoot(document.querySelector("#app"));
  const render = (anchor) =>
    React.createElement(
      exports.Row,
      { scrollKey: "cw", scrollAnchorKey: anchor },
      React.createElement("span", null, anchor),
    );

  try {
    await React.act(() => root.render(render("a")));
    const track = document.querySelector(".harbor-row-track");
    assert.ok(track);
    track.scrollLeft = 300;

    await React.act(() => root.render(render("b")));

    assert.equal(track.scrollLeft, 0);
    assert.ok(remembered.some(([key, value]) => key === "cw:b" && value === 0));
    assert.ok(remembered.some(([key, value]) => key === "cw:a" && value === 0));
  } finally {
    await React.act(() => root.unmount());
    dom.window.close();
    Object.assign(globalThis, previous);
  }
});
