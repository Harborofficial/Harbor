import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";
import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import * as jsxRuntime from "react/jsx-runtime";
import ts from "typescript";

test("Games AI search refreshes a submitted query after changing web source, not an idle query", async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: "https://harbor.test" });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  });

  const settings = {
    aiWebSource: "jina",
    aiWebSearch: true,
    aiGroqKey: "",
    aiSearchModel: "model",
  };
  const contextSources: string[] = [];
  const searches: Array<{ query: string; context: string | undefined }> = [];
  const noop = () => null;
  const modules: Record<string, unknown> = {
    react: React,
    "react/jsx-runtime": jsxRuntime,
    "lucide-react": { Globe: noop, Search: noop, Settings2: noop, X: noop },
    "@/lib/settings": {
      useSettings: () => ({ settings, update: Object.assign.bind(null, settings) }),
    },
    "@/lib/i18n": { useT: () => (s: string) => s, useUiLanguage: () => "en" },
    "@/lib/ai-search": { AiSearchError: class extends Error {} },
    "@/lib/ai-models": {
      aiKey: () => "model-key",
      aiIsGroq: () => false,
      AI_MODELS: [],
      GROQ_MODELS: [],
      DEFAULT_AI_MODEL: "model",
      modelLabelFor: () => "Model",
      providerTabFor: () => "openrouter",
    },
    "@/lib/ai-live-models": {
      pruneToCatalog: () => [],
      useOpenRouterCatalog: () => [],
      useGroqCatalog: () => [],
    },
    "@/components/dropdown": { Dropdown: noop },
    "@/components/modal-shell": {
      ModalShell: noop,
      useModalExit: () => ({ closing: false, close: noop }),
    },
    "@/lib/section-back": { useSectionBack: noop },
    "@/views/settings/ai-search-section": { AiSearchSection: noop },
    "@/lib/games/ai-search": {
      findGamesWithAi: async ({ query, context }: { query: string; context?: string }) => {
        searches.push({ query, context });
        return [];
      },
    },
    "@/lib/live-web": {
      liveWebContext: async (_query: string, selected: typeof settings) => {
        contextSources.push(selected.aiWebSource);
        return { context: selected.aiWebSource };
      },
    },
    "./game-search-results": { GameSearchResults: noop },
  };
  const source = readFileSync(
    new URL("../src/views/games/game-ai-search.tsx", import.meta.url),
    "utf8",
  );
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const exports: Record<string, any> = {};
  new Function("require", "exports", "useState", "useRef", "useEffect", output)(
    (name: string) => {
      assert.ok(name in modules, `Unexpected dependency: ${name}`);
      return modules[name];
    },
    exports,
    React.useState,
    React.useRef,
    React.useEffect,
  );

  const root = createRoot(document.getElementById("root")!);
  const filters = {};
  const onResults = () => {};
  const props = (query: string, runSignal: number) => ({
    query,
    runSignal,
    filters,
    active: true,
    onResults,
    open: noop,
  });
  const render = async (query: string, runSignal: number) => {
    await act(async () => {
      root.render(React.createElement(exports.GameAiSearch, props(query, runSignal)));
    });
  };
  try {
    await render("Hades", 0);
    settings.aiWebSource = "keenable";
    await render("Hades", 0);
    assert.deepEqual(searches, [], "switching source must not start a never-submitted query");

    await render("Hades", 1);
    assert.deepEqual(searches, [{ query: "Hades", context: "keenable" }]);

    settings.aiWebSource = "jina";
    await render("Hades", 1);
    assert.deepEqual(
      searches,
      [
        { query: "Hades", context: "keenable" },
        { query: "Hades", context: "jina" },
      ],
      "changing source should rerun exactly once without another submit",
    );

    await render("Celeste", 1);
    settings.aiWebSource = "keenable";
    await render("Celeste", 1);
    assert.equal(searches.length, 2, "do not automatically submit an edited query");

    await render("Celeste", 2);
    assert.deepEqual(searches[2], { query: "Celeste", context: "keenable" });
    assert.deepEqual(contextSources, ["keenable", "jina", "keenable"]);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
  }
});
