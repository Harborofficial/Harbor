import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { JSDOM } from "jsdom";
import * as React from "react";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot } from "react-dom/client";

function load(path: string, dependencies: Record<string, unknown>) {
  const source = readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  });
  const module = { exports: {} as any };
  const mocks: Record<string, unknown> = {
    react: React,
    "react/jsx-runtime": jsx,
    "@/lib/i18n": {
      useT:
        () =>
        (key: string, vars: Record<string, string> = {}) =>
          key.replace(/\{(\w+)\}/g, (_, name) => vars[name] ?? name),
    },
    ...dependencies,
  };
  new Function("require", "module", "exports", outputText)(
    (name: string) => {
      assert.ok(name in mocks, `Missing mock: ${name}`);
      return mocks[name];
    },
    module,
    module.exports,
  );
  return module.exports;
}

test("image-only Home groups keep accessible names and show only their assigned folders", () => {
  const { HomeGroups } = load("components/home-groups.tsx", {
    "@/components/icons/harbor-mark": { HarborMark: () => <svg /> },
    "@/components/row": {
      Row: ({ title, children }: any) => <section aria-label={title}>{children}</section>,
    },
    "@/lib/view": { useView: () => ({ setView: () => {} }) },
  });
  const dom = new JSDOM(
    renderToStaticMarkup(
      <HomeGroups
        title="Platforms"
        groups={[
          {
            id: "netflix",
            name: "Netflix",
            image: "https://example.test/logo.png",
            lists: [],
            hideHomeTitle: true,
          },
          { id: "prime", name: "Prime", lists: [] },
        ]}
      />,
    ),
  );
  try {
    const buttons = dom.window.document.querySelectorAll("button");
    assert.equal(buttons.length, 2);
    assert.equal(buttons[0].getAttribute("aria-label"), "Netflix");
    assert.equal(buttons[0].textContent, "");
    assert.equal(buttons[1].textContent, "Prime");
    assert.ok(buttons[0].querySelector("img")?.classList.contains("object-cover"));
  } finally {
    dom.window.close();
  }
});

test("section manager renames stable rows and removes sections without deleting folders", async () => {
  const dom = new JSDOM("<div id='root'></div>", { url: "http://localhost/" });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  let settings = {
    libraryGroupSections: [{ id: "platforms", name: "Platforms" }],
    libraryGroups: [
      {
        id: "netflix",
        name: "Netflix",
        homeSectionId: "platforms",
        pinnedToHome: true,
        lists: [{ id: "movies" }],
      },
    ],
    homeRows: {
      renamed: { "library-groups:platforms": "Services" },
      order: ["catalog", "library-groups:platforms"],
    },
  };
  const { GroupSections } = load("views/library/groups/group-sections.tsx", {
    "@/lib/settings": {
      useSettings: () => ({
        settings,
        update: (patch: any) => {
          settings = { ...settings, ...patch };
        },
      }),
    },
    "@/lib/uuid": { randomUuid: () => "new-section" },
    "./group-editor": { groupButtonClass: "", groupInputClass: "" },
    "lucide-react": { ChevronDown: () => <svg /> },
  });
  const root = createRoot(dom.window.document.getElementById("root")!);
  const render = () => React.act(() => root.render(<GroupSections />));
  const click = async (label: string) => {
    const button = [...dom.window.document.querySelectorAll("button")].find(
      (entry) => entry.textContent === label,
    );
    assert.ok(button, label);
    await React.act(() => button.click());
  };
  try {
    await render();
    await click("Home sections");
    await click("Rename");
    assert.equal(dom.window.document.querySelector("input")?.value, "Services");
    await React.act(() =>
      dom.window.document
        .querySelector("form")!
        .dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })),
    );
    assert.deepEqual(settings.libraryGroupSections, [{ id: "platforms", name: "Services" }]);
    assert.deepEqual(settings.homeRows.renamed, {});
    assert.deepEqual(settings.homeRows.order, ["catalog", "library-groups:platforms"]);
    await render();
    await click("Remove section");
    assert.deepEqual(settings.libraryGroupSections, []);
    assert.equal(settings.libraryGroups[0].homeSectionId, undefined);
    assert.equal(settings.libraryGroups[0].pinnedToHome, true);
    assert.deepEqual(settings.libraryGroups[0].lists, [{ id: "movies" }]);
  } finally {
    await React.act(() => root.unmount());
    dom.window.close();
  }
});
