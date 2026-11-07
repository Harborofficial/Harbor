import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";
import * as React from "react";
import * as ReactDOM from "react-dom";
import * as jsxRuntime from "react/jsx-runtime";
import { createRoot } from "react-dom/client";
import * as icons from "lucide-react";
import ts from "typescript";

const dependencies = {
  react: React,
  "react-dom": ReactDOM,
  "react/jsx-runtime": jsxRuntime,
  "lucide-react": icons,
  "@/lib/keyboard-navigation": { advanceFocus: (el) => el.focus() },
  "@/lib/back-intercept": { pushBackHandler: () => () => {} },
  "@/lib/keyboard-navigation/geometry": {
    getDirection: (event) => ({ ArrowDown: "down", ArrowUp: "up" })[event.key],
    isBackKey: (event) => event.key === "Escape",
  },
};
const output = ts.transpileModule(
  readFileSync(new URL("../src/components/dropdown.tsx", import.meta.url), "utf8"),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
const exports = {};
new Function("require", "exports", output)((name) => {
  assert.ok(name in dependencies, name);
  return dependencies[name];
}, exports);
const { Dropdown } = exports;

for (const multiple of [false, true]) {
  test(`dropdown ${multiple ? "toggles multiple selections without closing" : "preserves single-selection closing"}`, async () => {
    const dom = new JSDOM("<div id='root'></div>", { pretendToBeVisual: true });
    Object.assign(globalThis, {
      window: dom.window,
      document: dom.window.document,
      getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
      requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
      cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
      IS_REACT_ACT_ENVIRONMENT: true,
    });
    dom.window.HTMLElement.prototype.scrollIntoView = () => {};
    dom.window.matchMedia = () => ({ matches: true });
    const root = createRoot(document.getElementById("root"));
    let latest;
    function Fixture() {
      const [selected, setSelected] = React.useState(["home"]);
      latest = selected;
      return React.createElement(Dropdown, {
        value: selected[0] ?? "",
        selectedValues: multiple ? selected : undefined,
        options: [
          { value: "home", label: "Home" },
          { value: "anime", label: "Anime" },
        ],
        onChange: (value) =>
          setSelected((prev) =>
            multiple
              ? prev.includes(value)
                ? prev.filter((v) => v !== value)
                : [...prev, value]
              : [value],
          ),
      });
    }
    try {
      await React.act(async () => root.render(React.createElement(Fixture)));
      const trigger = document.querySelector("button");
      await React.act(async () => trigger.click());
      const options = [...document.querySelectorAll('[role="option"]')];
      await React.act(async () => options[1].click());
      assert.deepEqual(latest, multiple ? ["home", "anime"] : ["anime"]);
      if (multiple) {
        assert.equal(
          document.querySelector('[role="listbox"]').getAttribute("aria-multiselectable"),
          "true",
        );
        assert.equal(document.querySelectorAll('[aria-selected="true"]').length, 2);
        await React.act(async () => options[0].click());
        assert.deepEqual(latest, ["anime"]);
        await React.act(async () =>
          options[1].dispatchEvent(
            new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
          ),
        );
      }
      assert.equal(document.querySelector('[role="listbox"]'), null);
      assert.equal(document.activeElement, trigger);
    } finally {
      await React.act(async () => root.unmount());
      dom.window.close();
    }
  });
}
