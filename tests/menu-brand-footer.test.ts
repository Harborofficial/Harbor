import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import ts from "typescript";
import { HarborMark } from "../src/components/icons/harbor-mark.tsx";

test("root branding uses the real mark, preserves custom assets, and adds no command", async () => {
  const dom = new JSDOM("<div id='root'></div><div id='other'></div>");
  const style = dom.window.document.createElement("style");
  style.textContent = readFileSync(
    new URL("../src/components/context-menu/menu-brand-footer.css", import.meta.url),
    "utf8",
  );
  dom.window.document.head.append(style);
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  let logo: { mark: string | null; wordmark: string | null } = { mark: null, wordmark: null };
  const code = ts.transpileModule(
    readFileSync(
      new URL("../src/components/context-menu/menu-brand-footer.tsx", import.meta.url),
      "utf8",
    ),
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
      },
    },
  ).outputText;
  const dependencies = {
    react: React,
    "react/jsx-runtime": jsxRuntime,
    "@/components/icons/harbor-mark": { HarborMark },
    "@/lib/harbor-logo": { useHarborLogo: () => logo },
    "./menu-brand-footer.css": {},
  };
  const module = { exports: {} as { MenuBrandFooter: React.ComponentType } };
  new Function("require", "module", "exports", code)(
    (name: keyof typeof dependencies) => {
      assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
      return dependencies[name];
    },
    module,
    module.exports,
  );
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(document.getElementById("root")!);
  const otherRoot = createRoot(document.getElementById("other")!);
  const render = () =>
    React.act(() => root.render(React.createElement(module.exports.MenuBrandFooter)));
  try {
    await render();
    const footer = document.querySelector("[data-context-brand-footer]")!;
    await React.act(() => otherRoot.render(React.createElement(HarborMark)));
    for (const layout of ["classic", "dracula", "rail", "stremio"]) {
      document.documentElement.setAttribute("data-theme-layout", layout);
      assert.equal(
        dom.window.getComputedStyle(footer).color,
        "rgb(235, 160, 24)",
        `menu branding keeps its approved color in ${layout}`,
      );
    }
    assert.notEqual(
      dom.window.getComputedStyle(document.querySelector("#other svg")!).color,
      "rgb(235, 160, 24)",
      "the shared Harbor mark outside a menu is not recolored",
    );
    assert.equal(footer.getAttribute("aria-hidden"), "true");
    assert.equal(footer.querySelector("svg")?.getAttribute("viewBox"), "0 0 700 642.88");
    assert.equal(footer.textContent, "");
    assert.equal(footer.querySelector("button,a,[tabindex],[role^='menuitem']"), null);
    logo = {
      mark: "data:image/svg+xml,fixture-colored-mark",
      wordmark: "data:image/svg+xml,fixture-wordmark",
    };
    await render();
    const imgs = footer.querySelectorAll("img");
    assert.equal(imgs.length, 2);
    assert.equal(imgs[0].getAttribute("src"), logo.mark);
    assert.equal(imgs[1].getAttribute("src"), logo.wordmark);
    for (const img of imgs) {
      assert.equal(img.alt, "");
      assert.equal(img.draggable, false);
      assert.equal(img.style.maskImage, "");
    }
    const filterId = /^url\(["']?#([^"')]+)["']?\)$/.exec(imgs[0].style.filter)?.[1];
    assert.ok(filterId, "the custom mark uses the footer's alpha-preserving color filter");
    const tint = document.getElementById(filterId)!;
    assert.equal(tint.querySelector("feFlood")?.getAttribute("flood-color"), "#EBA018");
    assert.equal(tint.querySelector("feComposite")?.getAttribute("in2"), "SourceAlpha");
    assert.equal(tint.querySelector("feComposite")?.getAttribute("operator"), "in");
    assert.equal(imgs[1].style.filter, "", "the wordmark preserves its own colors");
    await React.act(() => imgs[0].dispatchEvent(new dom.window.Event("error")));
    assert.ok(footer.querySelector("svg.context-menu-brand-mark"));
    assert.equal(footer.querySelectorAll("img").length, 1);
    logo = { mark: "data:image/svg+xml,next-fixture-mark", wordmark: null };
    await render();
    assert.equal(footer.querySelector("svg.context-menu-brand-mark"), null);
    assert.equal(footer.querySelector("img")?.getAttribute("src"), logo.mark);
  } finally {
    await React.act(() => root.unmount());
    await React.act(() => otherRoot.unmount());
    dom.window.close();
  }
});
