import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { JSDOM } from "jsdom";
import * as React from "react";
import * as jsx from "react/jsx-runtime";
import { createRoot } from "react-dom/client";

function load(path, dependencies, globals = {}) {
  const code = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    ...globals,
    require: (name) => {
      assert.ok(name in dependencies, `Unmocked dependency: ${name}`);
      return dependencies[name];
    },
  });
  return module.exports;
}

async function withRoot(run) {
  const dom = new JSDOM("<div id='app'></div>", { url: "http://localhost/" });
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    IS_REACT_ACT_ENVIRONMENT: globalThis.IS_REACT_ACT_ENVIRONMENT,
  };
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const root = createRoot(document.getElementById("app"));
  try {
    await run(root);
  } finally {
    await React.act(() => root.unmount());
    Object.assign(globalThis, previous);
    dom.window.close();
  }
}

test("episode date rendering reuses formatters and preserves UTC and default-locale output", () => {
  let constructions = 0;
  const dates = load(
    "src/lib/dates.ts",
    {},
    {
      Intl: {
        DateTimeFormat: function (locale, options) {
          constructions++;
          return new Intl.DateTimeFormat(locale, options);
        },
      },
    },
  );
  for (const value of [undefined, null, "", "invalid"]) {
    assert.equal(dates.formatAirDate(value), "");
    assert.equal(dates.formatAirDateShort(value), "");
  }
  for (const value of ["2024-04-05", "2024-04-05T23:30:00-07:00"]) {
    const date = new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
    for (let i = 0; i < 100; i++) {
      assert.equal(
        dates.formatAirDate(value),
        date.toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
          year: "numeric",
          timeZone: "UTC",
        }),
      );
      assert.equal(
        dates.formatAirDateShort(value),
        date.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" }),
      );
    }
  }
  assert.equal(constructions, 2);
});

test("translation callbacks remain stable until the language, region, or lazy catalog changes", async () => {
  let language = "en";
  let region = "US";
  const listeners = new Set();
  const subscribe = (fn) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  };
  const notify = () => listeners.forEach((fn) => fn());
  const i18n = load("src/lib/i18n/translate.ts", {
    react: React,
    "./locales/en": { default: {} },
    "./store": {
      getUiLanguage: () => language,
      getUiRegion: () => region,
      useUiLanguage: () => React.useSyncExternalStore(subscribe, () => language),
      useUiRegion: () => React.useSyncExternalStore(subscribe, () => region),
    },
    "@/lib/render-cause": { noteNotify() {} },
    "./languages": { isRtl: () => false, LANGUAGES: [] },
    "./regional-labels": { associationFootballEnglishLabel: () => "Soccer" },
  });
  let current;
  function Probe() {
    current = i18n.useT();
    return current("Season {n}", { n: 3 });
  }
  await withRoot(async (root) => {
    await React.act(() => root.render(React.createElement(Probe)));
    const original = current;
    await React.act(() => root.render(React.createElement(Probe)));
    assert.equal(current, original);
    await React.act(() => {
      language = "tr";
      notify();
    });
    assert.notEqual(current, original);
    assert.equal(document.body.textContent, "Season 3");
    const pending = current;
    await React.act(() => i18n.registerUiCatalog("tr", { "Season {n}": "Sezon {n}" }));
    assert.notEqual(current, pending);
    assert.equal(document.body.textContent, "Sezon 3");
    const loaded = current;
    await React.act(() => root.render(React.createElement(Probe)));
    assert.equal(current, loaded);
    await React.act(() => {
      region = "TR";
      notify();
    });
    assert.notEqual(current, loaded);
    assert.equal(document.body.textContent, "Sezon 3");
  });
});

test("hero updates preserve unchanged media rails while data, reasons, and translations still update", async () => {
  const built = [];
  const Locale = React.createContext("en");
  const card = (kind) => (props) => {
    built.push(kind);
    return React.createElement("span", null, props.reason ?? props.cast?.name ?? "card");
  };
  const { DetailCastRail, DetailProviderCastRail, DetailCharacterRail, DetailRecommendationRail } =
    load("src/views/detail/media-rails.tsx", {
      react: React,
      "react/jsx-runtime": jsx,
      "@/components/pick-card": { PickCard: card("pick") },
      "@/components/row": {
        Row: ({ title, children }) => React.createElement("section", null, title, children),
      },
      "@/lib/i18n": {
        useT: () => {
          const language = React.useContext(Locale);
          return (key, vars) => `${language}:${key.replace("{n}", String(vars?.n))}`;
        },
      },
      "./cast-card": { CastCard: card("cast") },
      "./character-card": { CharacterCard: card("character") },
    });
  const cast = [{ id: 1, name: "Actor" }];
  const providerCast = ["Provider actor"];
  const characters = [{ id: 2 }];
  const items = [{ id: "kitsu:3", name: "Related" }];
  const reasons = new Map([["kitsu:3", { label: "Same source", rank: 1 }]]);
  function Page({ hero, activeReasons = reasons, language = "en" }) {
    return React.createElement(
      Locale.Provider,
      { value: language },
      React.createElement("header", null, hero),
      React.createElement(DetailCastRail, { cast }),
      React.createElement(DetailProviderCastRail, { cast: providerCast }),
      React.createElement(DetailCharacterRail, { characters }),
      React.createElement(DetailRecommendationRail, {
        title: "More Like This",
        items,
        reasons: activeReasons,
      }),
    );
  }
  await withRoot(async (root) => {
    await React.act(() => root.render(React.createElement(Page, { hero: "Season 1" })));
    assert.equal(built.length, 4);
    await React.act(() => root.render(React.createElement(Page, { hero: "Season 3" })));
    assert.equal(built.length, 4, "season artwork must not rebuild unrelated cards");
    await React.act(() =>
      root.render(React.createElement(Page, { hero: "Season 3", activeReasons: new Map() })),
    );
    assert.equal(built.length, 5, "changed recommendation evidence must render");
    await React.act(() =>
      root.render(React.createElement(Page, { hero: "Season 3", language: "tr" })),
    );
    assert.ok(document.body.textContent.includes("tr:Cast"));
    assert.ok(document.body.textContent.includes("Same source"));
    assert.equal(built.length, 9);
  });
});
