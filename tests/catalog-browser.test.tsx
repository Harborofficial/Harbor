import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { JSDOM } from "jsdom";
import * as React from "react";
import * as jsx from "react/jsx-runtime";
import { createRoot } from "react-dom/client";
import type { BrowseCatalog } from "../src/lib/catalog-browse";

test("catalog browsing preserves genre selection and pagination and resets on catalog/type changes", async () => {
  const dom = new JSDOM("<div id='root'></div>", { url: "http://localhost/" });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const opened: any[] = [];
  const fetched: any[] = [];
  const module = { exports: {} as any };
  const mocks: Record<string, unknown> = {
    react: React,
    "react/jsx-runtime": jsx,
    "lucide-react": { ChevronDown: () => <svg /> },
    "@/components/icons/search-icon": { Search: () => <svg /> },
    "@/lib/i18n": { useT: () => (key: string) => key },
    "@/lib/session-state": {
      useSessionState: (_key: string, initial: unknown) => React.useState(initial),
    },
    "@/lib/view": { useView: () => ({ openGrid: (grid: any) => opened.push(grid) }) },
    "@/lib/catalog-browse": {
      catalogTypeLabelKey: (type: string) => ({ movie: "Movies", series: "Series" })[type],
      browseFetcher: (catalog: BrowseCatalog, genre: string | null) => async (page: number) => {
        fetched.push([catalog.key, genre, page]);
        return [];
      },
    },
  };
  const source = readFileSync(
    new URL("../src/views/catalogs/catalog-browser.tsx", import.meta.url),
    "utf8",
  );
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  });
  new Function("require", "module", "exports", outputText)(
    (name: string) => {
      assert.ok(name in mocks, name);
      return mocks[name];
    },
    module,
    module.exports,
  );
  const { CatalogBrowser } = module.exports;
  const catalog = (key: string, type: string, genres: string[]): BrowseCatalog => ({
    key,
    type,
    genres,
    name: key,
    id: key,
    addonName: "Addon",
    base: "https://example.test",
    genreExtra: genres.length ? "Genre" : null,
  });
  const catalogs = [
    catalog("Popular", "movie", ["Comedy"]),
    catalog("Latest", "movie", []),
    catalog("Shows", "series", ["Drama"]),
  ];
  const root = createRoot(dom.window.document.getElementById("root")!);
  const render = (items: BrowseCatalog[]) =>
    React.act(() => root.render(<CatalogBrowser catalogs={items} />));
  const click = async (prefix: string) => {
    const button = [...dom.window.document.querySelectorAll("button")].find(
      (entry) =>
        entry.textContent?.startsWith(prefix) ||
        [...entry.querySelectorAll("span")].some((span) => span.textContent === prefix),
    );
    assert.ok(button, prefix);
    await React.act(() => button.click());
  };
  try {
    await render(catalogs);
    await click("Genre");
    await click("Comedy");
    await click("Browse");
    assert.equal(opened.at(-1).title, "Popular · Comedy");
    await opened.at(-1).fetcher(2);
    assert.deepEqual(fetched.at(-1), ["Popular", "Comedy", 2]);
    await click("Catalog");
    await click("Latest");
    assert.ok(
      ![...dom.window.document.querySelectorAll("button")].some((entry) =>
        entry.textContent?.startsWith("Genre"),
      ),
    );
    await click("Browse");
    await opened.at(-1).fetcher(1);
    assert.deepEqual(fetched.at(-1), ["Latest", null, 1]);
    await click("Type");
    await click("Series");
    await click("Browse");
    assert.equal(opened.at(-1).title, "Shows");
    await render([catalogs[0]]);
    await click("Browse");
    assert.equal(opened.at(-1).title, "Popular");
    await render([]);
    assert.equal(dom.window.document.querySelectorAll("button").length, 0);
  } finally {
    await React.act(() => root.unmount());
    dom.window.close();
  }
});

test("Catalogs owns the browser alongside shelf management; Discover no longer mounts it", () => {
  const read = (path: string) =>
    readFileSync(new URL(`../src/views/${path}`, import.meta.url), "utf8");
  assert.match(read("catalogs.tsx"), /<CatalogBrowser catalogs=\{catalogs\}/);
  assert.match(read("catalogs.tsx"), /<CatalogManageList/);
  assert.match(read("catalogs.tsx"), /<CatalogShelf/);
  assert.doesNotMatch(read("discover.tsx"), /CatalogBrowser|section-catalog/);
});
