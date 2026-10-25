// @ts-expect-error Node tests are outside the browser tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node tests are outside the browser tsconfig.
import test from "node:test";
import {
  catalogAccountAddons,
  catalogSource,
  orderLocalCatalogs,
  rememberCatalogAddons,
  rememberedCatalogAddons,
  saveLocalCatalogOrder,
  setCatalogSource,
} from "../src/lib/local-catalogs";
import type { Addon } from "../src/lib/addons";

const values = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  },
});
const addon: Addon = {
  transportUrl: "https://example.test/manifest.json",
  manifest: {
    id: "example",
    name: "Example",
    catalogs: [
      {
        id: "movies",
        name: "Movies",
        type: "movie",
        extra: [{ name: "genre", options: ["Drama", "Comedy"] }],
      },
    ],
  },
};
function reset(profile = "a") {
  values.clear();
  values.set("harbor.profiles.v1", JSON.stringify({ activeId: profile }));
}

test("local catalogs load with no session and never fetch the account", async () => {
  reset();
  rememberCatalogAddons([addon]);
  setCatalogSource("local");
  let requests = 0;
  const fetchAccount = async () => {
    requests++;
    return [];
  };
  assert.deepEqual(await catalogAccountAddons(null, fetchAccount), [addon]);
  assert.deepEqual(await catalogAccountAddons("still-signed-in", fetchAccount), [addon]);
  assert.equal(requests, 0);
});

test("successful account reads preserve complete genre/filter definitions", async () => {
  reset();
  assert.equal(catalogSource(), "combined");
  await catalogAccountAddons("session", async () => [addon]);
  assert.deepEqual(rememberedCatalogAddons(), [addon]);
});

test("network failure preserves the last collection; confirmed empty collections clear it", async () => {
  reset();
  rememberCatalogAddons([addon]);
  assert.deepEqual(await catalogAccountAddons("session", async () => null), [addon]);
  assert.deepEqual(await catalogAccountAddons("session", async () => []), []);
  assert.deepEqual(rememberedCatalogAddons(), []);
});

test("account mode without login does not silently use another source", async () => {
  reset();
  rememberCatalogAddons([addon]);
  setCatalogSource("stremio");
  assert.deepEqual(
    await catalogAccountAddons(null, async () => {
      throw Error("must not run");
    }),
    [],
  );
});

test("a response arriving after profile switch remains in its original profile", async () => {
  reset();
  await catalogAccountAddons("session", async () => {
    values.set("harbor.profiles.v1", JSON.stringify({ activeId: "b" }));
    return [addon];
  });
  assert.deepEqual(rememberedCatalogAddons(), []);
  assert.deepEqual(rememberedCatalogAddons("a"), [addon]);
  assert.equal(catalogSource(), "combined");
});

test("local ordering persists independently and appends new catalogs", () => {
  reset();
  setCatalogSource("local");
  saveLocalCatalogOrder(["b", "a"]);
  const catalogs = [{ key: "a" }, { key: "b" }, { key: "new" }];
  assert.deepEqual(
    orderLocalCatalogs(catalogs).map((c) => c.key),
    ["b", "a", "new"],
  );
  assert.deepEqual(
    catalogs.map((c) => c.key),
    ["a", "b", "new"],
  );
  setCatalogSource("combined");
  assert.deepEqual(orderLocalCatalogs(catalogs), catalogs);
});

test("malformed persisted addon data cannot become a catalog", () => {
  reset();
  values.set("harbor.catalogs.local.a.addons", JSON.stringify([null, {}, addon]));
  assert.deepEqual(rememberedCatalogAddons(), [addon]);
});
