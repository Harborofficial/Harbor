import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { JSDOM } from "jsdom";
import * as React from "react";
import * as jsx from "react/jsx-runtime";
import { createRoot } from "react-dom/client";

test("row initialization consumes observer width and passes the known page scroll root", async () => {
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
  const subscriptions = [];
  const roots = [];
  let layoutReads = 0;
  let saved = null;
  const remembered = [];
  dom.window.HTMLElement.prototype.getBoundingClientRect = () => {
    layoutReads++;
    throw new Error("forced initial layout");
  };
  const settings = {
    posterScale: 1,
    rowTitleScale: 1,
    rowCardStyle: "poster",
    posterBackdropExpansion: false,
    posterDockMagnification: false,
  };
  const mocks = {
    react: React,
    "@/lib/poster-dock": { resetPosterDock: () => {}, updatePosterDock: () => {} },
    "react/jsx-runtime": jsx,
    "@/lib/visibility": {
      observeResize: (el, cb) => {
        subscriptions.push({ el, cb });
        return () => {};
      },
      observeWithin: (_el, _margin, _cb, root) => {
        roots.push(root);
        return () => {};
      },
    },
    "@/lib/settings": { useSettings: () => ({ settings }) },
    "@/lib/i18n": { useT: () => (s) => s, useUiLanguage: () => "en", isRtl: () => false },
    "@/lib/view": {
      useViewActions: () => ({
        rememberRowScroll: (_key, value) => remembered.push(value),
        recallRowScroll: () => saved,
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
  const scroller = document.createElement("main");
  try {
    await React.act(() =>
      root.render(
        React.createElement(
          exports.ScrollRootContext.Provider,
          { value: scroller },
          React.createElement(exports.Row, null),
        ),
      ),
    );
    assert.ok(roots.includes(scroller));
    const container = subscriptions.find(({ el }) => el.classList.contains("group/row"));
    assert.ok(container);
    await React.act(async () => {
      container.cb({ width: 1000, height: 240 });
      const pending = [...frames.values()];
      frames.clear();
      for (const frame of pending) frame(0);
      await Promise.resolve();
    });
    assert.equal(document.querySelector(".harbor-row-track").style.gridAutoColumns, "150.015625px");
    assert.equal(layoutReads, 0);
    frames.clear();
    await React.act(async () => {
      container.cb({ width: 1000, height: 400 });
      const trackSubscription = subscriptions.find(({ el }) =>
        el.classList.contains("harbor-row-track"),
      );
      trackSubscription.cb({ width: 1000, height: 400 });
      const pending = [...frames.values()];
      frames.clear();
      for (const frame of pending) frame(0);
      await Promise.resolve();
    });
    frames.clear();
    await React.act(() => {
      container.cb({ width: 1000, height: 600 });
      subscriptions
        .find(({ el }) => el.classList.contains("harbor-row-track"))
        .cb({ width: 1000, height: 600 });
    });
    assert.equal(
      frames.size,
      0,
      "height-only changes must not schedule horizontal layout measurements",
    );
    const track = document.querySelector(".harbor-row-track");
    track.scrollLeft = 123;
    await React.act(() => track.dispatchEvent(new dom.window.Event("scroll")));
    // Remount with a saved position and enough horizontal overflow to restore it.
    await React.act(() => root.render(null));
    saved = 240;
    const originalWidth = Object.getOwnPropertyDescriptor(
      dom.window.HTMLElement.prototype,
      "clientWidth",
    );
    Object.defineProperty(dom.window.HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get: () => 1000,
    });
    Object.defineProperty(dom.window.HTMLElement.prototype, "scrollWidth", {
      configurable: true,
      get: () => 2000,
    });
    subscriptions.length = 0;
    await React.act(() =>
      root.render(
        React.createElement(
          exports.Row,
          { scrollKey: "saved" },
          React.createElement("span", null, "item"),
        ),
      ),
    );
    await React.act(async () => {
      subscriptions
        .find(({ el }) => el.classList.contains("group/row"))
        .cb({ width: 1000, height: 240 });
      const pending = [...frames.values()];
      frames.clear();
      for (const frame of pending) frame(0);
      await Promise.resolve();
    });
    const restored = document.querySelector(".harbor-row-track");
    assert.equal(restored.scrollLeft, 240);
    restored.scrollLeft = 345;
    await React.act(() => restored.dispatchEvent(new dom.window.Event("scroll")));
    Object.defineProperty(restored, "scrollLeft", {
      get: () => {
        throw new Error("cleanup must not read layout");
      },
    });
    await React.act(() => root.render(null));
    assert.ok(remembered.includes(345));
    if (originalWidth)
      Object.defineProperty(dom.window.HTMLElement.prototype, "clientWidth", originalWidth);
  } finally {
    await React.act(() => root.unmount());
    dom.window.close();
    Object.assign(globalThis, previous);
  }
});
