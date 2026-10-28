import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { JSDOM } from "jsdom";
import * as React from "react";
import * as jsx from "react/jsx-runtime";
import { createRoot } from "react-dom/client";

test("Home builds cards only for activated rows and preserves unchanged row subtrees", async () => {
  const dom = new JSDOM("<div id='app'></div>", { url: "http://localhost/" });
  const previous = { window: globalThis.window, document: globalThis.document };
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const built = [];
  let reveal;
  const settings = { hideUnreleased: false };
  const empty = () => null;
  const PickCard = () => null;
  const wrap =
    (fn) =>
    (type, props, ...args) => {
      if (type === PickCard) built.push(props.meta.id);
      return fn(type, props, ...args);
    };
  const mocks = {
    react: React,
    "@/components/profiled": { Profiled: ({ children }) => children },
    "react/jsx-runtime": { ...jsx, jsx: wrap(jsx.jsx), jsxs: wrap(jsx.jsxs) },
    "lucide-react": { ChevronRight: empty },
    "@/components/home-groups": { HomeGroups: empty },
    "@/components/lazy-mount": {
      LazyMount: ({ children }) => {
        const [shown, setShown] = React.useState(false);
        reveal = () => setShown(true);
        return shown ? children : null;
      },
    },
    "@/lib/release-info": {},
    "@/components/pick-card": { PickCard },
    "@/components/row": {
      usePosterRow: () => ({ min: 144, shape: "portrait" }),
      Row: ({ children }) => children,
    },
    "@/components/custom-sources-row": {},
    "@/components/top-rank-card": {},
    "@/components/letterboxd/letterboxd-row-menu": {},
    "@/lib/stremboxd/provider": { useLetterboxd: () => ({}) },
    "@/lib/i18n": { useT: () => (key) => key },
    "@/lib/view": { useViewActions: () => ({ openGrid: empty }) },
    "./row-controls": {},
    "@/lib/watched-title": { collapseWatchedKeys: (keys) => keys },
    "@/lib/settings": { useSettings: () => ({ settings }) },
  };
  const code = ts.transpileModule(
    readFileSync(new URL("../src/views/home/customizable-rows.tsx", import.meta.url), "utf8"),
    {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    },
  ).outputText;
  const exports = {};
  new Function("require", "exports", code)((name) => mocks[name] ?? {}, exports);
  const rows = [0, 1, 2].map((n) => ({
    key: `row-${n}`,
    name: `Row ${n}`,
    metas: [{ id: `title-${n}`, name: `Title ${n}` }],
  }));
  const props = {
    rows,
    editMode: false,
    customization: { hidden: [], renamed: {} },
    orderKeys: rows.map((row) => row.key),
    onMove: empty,
    onToggleHidden: empty,
    onRename: empty,
    onToggleNumerals: empty,
    onLoadMore: empty,
  };
  const root = createRoot(document.querySelector("#app"));
  try {
    await React.act(() => root.render(React.createElement(exports.CustomizableRows, props)));
    assert.deepEqual(built, ["title-0", "title-1"]);
    built.length = 0;
    await React.act(() =>
      root.render(
        React.createElement(exports.CustomizableRows, {
          ...props,
          rows: [{ ...rows[0] }, rows[1], rows[2]],
        }),
      ),
    );
    assert.deepEqual(
      built,
      ["title-0"],
      "loading one row must not rebuild other rows' card elements",
    );
    built.length = 0;
    await React.act(() => reveal());
    assert.deepEqual(
      built,
      ["title-2"],
      "off-screen cards are constructed when their boundary activates",
    );
  } finally {
    await React.act(() => root.unmount());
    dom.window.close();
    Object.assign(globalThis, previous);
  }
});
