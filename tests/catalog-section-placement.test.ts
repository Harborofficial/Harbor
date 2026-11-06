import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import type * as Store from "../src/lib/pinned-catalogs";

function loadStore(saved: unknown = []) {
  let stored = JSON.stringify(saved);
  const source = readFileSync(new URL("../src/lib/pinned-catalogs.ts", import.meta.url), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {} as typeof Store;
  new Function("exports", "require", "localStorage", output)(exports, () => ({}), {
    getItem: () => stored,
    setItem: (_key: string, value: string) => {
      stored = value;
    },
  });
  return { store: exports, saved: () => JSON.parse(stored) };
}

const catalog: Store.PinnedCatalog = {
  id: "addon:anime:popular",
  source: "catalog",
  name: "Popular Anime",
  params: { base: "https://example.com", type: "anime", id: "popular" },
};

test("legacy Home pins and single-page selections retain their destinations", () => {
  const { store } = loadStore([
    catalog,
    { ...catalog, id: "anime", section: "anime" },
    { ...catalog, id: "other", section: "unknown" },
  ]);
  assert.deepEqual(store.readPinnedCatalogs().map(store.catalogSections), [
    ["home"],
    ["anime"],
    ["home"],
  ]);
});

test("a catalog can appear on multiple pages, persists, and is only counted once", () => {
  const { store, saved } = loadStore([catalog]);
  assert.equal(store.setPinnedCatalogSections(catalog, ["home", "anime", "movies", "shows"]), true);
  assert.equal(store.pinnedCount(), 1);
  assert.deepEqual(store.catalogSections(store.readPinnedCatalogs()[0]), [
    "home",
    "movies",
    "shows",
    "anime",
  ]);
  const reloaded = loadStore(saved()).store;
  assert.deepEqual(reloaded.catalogSections(reloaded.readPinnedCatalogs()[0]), [
    "home",
    "movies",
    "shows",
    "anime",
  ]);
  assert.deepEqual(reloaded.readPinnedCatalogs()[0].params, catalog.params);
});

test("deselecting one page preserves others; deselecting all removes the pin", () => {
  const { store, saved } = loadStore([{ ...catalog, sections: ["home", "anime"] }]);
  store.setPinnedCatalogSections(catalog, ["anime"]);
  assert.deepEqual(store.catalogSections(store.readPinnedCatalogs()[0]), ["anime"]);
  store.setPinnedCatalogSections(catalog, []);
  assert.equal(store.pinnedCount(), 0);
  assert.deepEqual(saved(), []);
});

test("a full list allows more pages for an existing catalog but rejects new catalogs", () => {
  const entries = Array.from({ length: 12 }, (_, i) => ({ ...catalog, id: `catalog-${i}` }));
  const { store } = loadStore(entries);
  assert.equal(store.setPinnedCatalogSections(entries[0], ["home", "anime"]), true);
  assert.equal(store.setPinnedCatalogSections(catalog, ["shows"]), false);
  assert.equal(store.pinnedCount(), 12);
  assert.deepEqual(store.catalogSections(store.readPinnedCatalogs()[0]), ["home", "anime"]);
});

test("saved selections are deduplicated and invalid or empty selections do not create rails", () => {
  const { store } = loadStore([
    { ...catalog, sections: ["anime", "anime", "unknown", "movies"], section: "home" },
    { ...catalog, id: "empty", sections: [] },
  ]);
  assert.equal(store.pinnedCount(), 1);
  assert.deepEqual(store.catalogSections(store.readPinnedCatalogs()[0]), ["movies", "anime"]);
});
