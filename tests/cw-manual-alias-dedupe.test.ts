// @ts-expect-error Node test types are outside the browser tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are outside the browser tsconfig.
import { readFileSync } from "node:fs";
// @ts-expect-error Node test types are outside the browser tsconfig.
import test from "node:test";
import ts from "typescript";

function manualStore() {
  const data = new Map<string, string>();
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
    removeItem: (key: string) => data.delete(key),
  };
  const mocks: Record<string, unknown> = {
    "./active-profile-id": {
      isNuvioProviderActive: () => false,
      getNuvioActiveSlot: () => 1,
      nuvioWatchedScope: () => "",
      canPersistWatched: () => true,
      stremioProfileId: () => "",
      primaryProfileId: () => "",
    },
    "@/lib/render-cause": { noteNotify: () => {} },
    "@/lib/storage-recovery": {
      persistCritical: (key: string, value: string) => storage.setItem(key, value),
    },
  };
  const output = ts.transpileModule(
    readFileSync(new URL("../src/lib/manual-watched.ts", import.meta.url), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  const module = { exports: {} as any };
  new Function("require", "module", "exports", "localStorage", output)(
    (name: string) => mocks[name] ?? {},
    module,
    module.exports,
    storage,
  );
  return { data, store: module.exports };
}

const poster = "https://image.tmdb.org/t/p/w500/3I2zJkHQpu8t9c44u8UBSLDum4O.jpg";

test("manual watched aliases collapse to one Continue Watching card", () => {
  const h = manualStore();
  h.data.set("harbor.manualwatched.v1", JSON.stringify(["tmdb:tv:124744|1|1", "tt12861248|1|1"]));
  h.data.set(
    "harbor.manualwatched.meta.v1",
    JSON.stringify({
      "tmdb:tv:124744": {
        type: "series",
        name: "I, Sniper",
        poster,
        markedAt: "2026-11-05T06:21:44.000Z",
      },
      tt12861248: {
        type: "series",
        name: "I, Sniper",
        poster,
        markedAt: "2026-11-05T06:21:44.010Z",
      },
    }),
  );

  const items = h.store.manualWatchedLibraryItems();
  assert.equal(items.length, 1);
  assert.equal(items[0]._id, "tt12861248");
  assert.deepEqual(items[0].altIds, ["tmdb:tv:124744"]);
  assert.equal(items[0].state?.season, 1);
  assert.equal(items[0].state?.episode, 1);
});

test("derived id variants do not create extra manual cards", () => {
  const h = manualStore();
  h.data.set(
    "harbor.manualwatched.v1",
    JSON.stringify(["tmdb:tv:124744|1|2", "tv:124744|1|2", "series:tv:124744|1|2"]),
  );
  h.data.set(
    "harbor.manualwatched.meta.v1",
    JSON.stringify({
      "tmdb:tv:124744": {
        type: "series",
        name: "I, Sniper",
        poster,
        markedAt: "2026-11-05T06:21:44.000Z",
      },
    }),
  );

  const items = h.store.manualWatchedLibraryItems();
  assert.equal(items.length, 1);
  assert.equal(items[0]._id, "tmdb:tv:124744");
  assert.equal(items[0].altIds, undefined);
});

test("manual watched writes keep one key instead of expanding every alias", () => {
  const h = manualStore();
  h.store.setManualWatchedMany("tmdb:tv:124744", [{ season: 1, episode: 1 }], true);
  assert.deepEqual(JSON.parse(h.data.get("harbor.manualwatched.v1")!), ["tmdb:tv:124744|1|1"]);
});
