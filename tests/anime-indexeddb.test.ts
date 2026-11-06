import assert from "node:assert/strict";
import test from "node:test";

const old = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (key: string) => old.get(key) ?? null,
  setItem: (key: string, value: string) => void old.set(key, value),
  removeItem: (key: string) => void old.delete(key),
};

const tables = new Map<string, Map<string, any>>();
let failWrites = false;
const db = {
  objectStoreNames: { contains: (name: string) => tables.has(name) },
  createObjectStore(name: string) {
    tables.set(name, new Map());
  },
  close() {},
  transaction(name: string) {
    const table = tables.get(name)!;
    const tx: any = { oncomplete: null, onerror: null, onabort: null };
    let scheduled = false;
    const complete = () => {
      if (scheduled) return;
      scheduled = true;
      setTimeout(() => tx.oncomplete?.(), 0);
    };
    tx.objectStore = () => ({
      getAll() {
        const req: any = { result: undefined, onsuccess: null, onerror: null };
        queueMicrotask(() => {
          req.result = [...table.values()];
          req.onsuccess?.();
        });
        return req;
      },
      get(key: string) {
        const req: any = { result: undefined, onsuccess: null, onerror: null };
        queueMicrotask(() => {
          req.result = table.get(key);
          req.onsuccess?.();
        });
        return req;
      },
      put(value: { key: string }) {
        if (failWrites) {
          setTimeout(() => {
            tx.onerror?.();
            tx.onabort?.();
          }, 0);
          return { result: value.key };
        }
        table.set(value.key, structuredClone(value));
        complete();
        return { result: value.key };
      },
    });
    return tx;
  },
};
(globalThis as any).indexedDB = {
  open() {
    const request: any = {
      result: db,
      onupgradeneeded: null,
      onsuccess: null,
      onerror: null,
      onblocked: null,
    };
    queueMicrotask(() => {
      request.onupgradeneeded?.();
      request.onsuccess?.();
    });
    return request;
  },
};

old.set("harbor.anime-cw-ids.v1", JSON.stringify({ tt12345: "kitsu:17" }));
old.set("harbor.anime-cw-ids.v2", JSON.stringify({ "mal:62922": "kitsu:50993" }));
old.set("harbor.anime-play-ids.v1", JSON.stringify({ tt12345: "kitsu:18" }));

const ids = await import("../src/lib/anime-cw-ids.ts");
const storage = await import("../src/lib/anime-identity-db.ts");

test("old canonical and played identities migrate atomically into IndexedDB", async () => {
  assert.equal(ids.getAnimeCwId("tt12345"), "kitsu:18");
  await ids.animeCwIdsReady();
  const rows = await storage.animeDbReadIdentities();
  assert.equal(rows?.find((r) => r.key === "canonical:tt12345")?.value, "kitsu:17");
  assert.equal(rows?.find((r) => r.key === "played:tt12345")?.value, "kitsu:18");
  assert.equal(rows?.find((r) => r.key === "canonical:mal:62922")?.value, "kitsu:50993");
  assert.equal(old.has("harbor.anime-cw-ids.v2"), false);
  assert.equal(old.has("harbor.anime-play-ids.v1"), false);
});

test("new mapping writes are persisted, not capped at the old 400-entry limit", async () => {
  for (let n = 1; n <= 425; n++) ids.recordAnilistMalAlias(n, 90000 + n);
  ids.recordAnimeCwId("tt7777777", "kitsu:12345");
  // A pending batch commits asynchronously.
  for (let attempt = 0; attempt < 40; attempt++) {
    const rows = await storage.animeDbReadIdentities();
    if (rows?.some((r) => r.key === "canonical:tt7777777")) break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  const rows = await storage.animeDbReadIdentities();
  assert.ok((rows?.length ?? 0) > 425);
  assert.equal(rows?.find((r) => r.key === "alias:anilist:425")?.value, "mal:90425");
});

test("separate provider, entry and episode stores accept indexed records", async () => {
  assert.equal(
    await storage.animeDbWriteProvider({
      key: "anizip:anilist_id=195604",
      value: { mappings: { anilist_id: 195604 } },
      fetchedAt: Date.now(),
      expiresAt: Date.now() + 60000,
    }),
    true,
  );
  assert.equal(
    (await storage.animeDbReadProvider<any>("anizip:anilist_id=195604"))?.value?.mappings
      ?.anilist_id,
    195604,
  );
  assert.equal(
    await storage.animeDbWriteEpisodes([
      { key: "kitsu:50024:4", season: 2, episode: 4, absolute: 174, tvdbId: 12006278 },
    ]),
    true,
  );
  assert.equal(
    await storage.animeDbWriteEntries([
      { key: "kitsu:50024", ids: { anilist: 195604, kitsu: 50024 }, updatedAt: Date.now() },
    ]),
    true,
  );
  assert.ok(tables.get("episode_mappings")?.has("kitsu:50024:4"));
  assert.ok(tables.get("anime_entries")?.has("kitsu:50024"));
});

test("provider mapping cache migrates without losing values or introducing a new lookup", async () => {
  const { mappingStore } = await import("../src/lib/providers/mapping-store.ts");
  const legacyKey = "harbor.mapping-test.v1";
  old.set(legacyKey, JSON.stringify({ initial: { kitsu: 50024, t: 1 } }));
  const store = mappingStore<{ kitsu: number; t: number }>(legacyKey);
  assert.equal(store.get("initial")?.kitsu, 50024);
  await store.ready;
  assert.equal(old.has(legacyKey), false);
  store.set("second", { kitsu: 50993, t: 2 });
  await new Promise((resolve) => setTimeout(resolve, 675));
  const stored = await storage.animeDbReadProvider<Record<string, { kitsu: number }>>(
    `mapping-store:${legacyKey}`,
  );
  assert.equal(stored?.value?.initial?.kitsu, 50024);
  assert.equal(stored?.value?.second?.kitsu, 50993);
});

test("a failed IndexedDB flush leaves a recoverable fallback snapshot", async () => {
  failWrites = true;
  ids.recordAnimeCwId("tt7777778", "kitsu:12346");
  let fallback = "";
  for (let attempt = 0; attempt < 80; attempt++) {
    fallback = old.get("harbor.anime-cw-ids.fallback.v1") ?? "";
    if (fallback.includes("kitsu:12346")) break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.match(fallback, /kitsu:12346/);
  failWrites = false;
  const cold = await import("../src/lib/anime-cw-ids.ts?fallback-test=1");
  await cold.animeCwIdsReady();
  assert.equal(cold.getAnimeCwId("tt7777778"), "kitsu:12346");
});

test("a failed mapping-store save keeps a pending fallback", async () => {
  const { mappingStore } = await import("../src/lib/providers/mapping-store.ts");
  const storageKey = "harbor.mapping-failure.v1";
  const store = mappingStore<{ kitsu: number; t: number }>(storageKey);
  await store.ready;
  failWrites = true;
  try {
    store.set("failed", { kitsu: 12346, t: 1 });
    await new Promise((resolve) => setTimeout(resolve, 675));
    assert.match(old.get(`${storageKey}.pending.v1`) ?? "", /12346/);
  } finally {
    failWrites = false;
  }
});

test("persisted aliases and played identities hydrate after a fresh module load", async () => {
  const cold = await import("../src/lib/anime-cw-ids.ts?test-cold-start=1");
  await cold.animeCwIdsReady();
  assert.equal(cold.getAnimeCwId("tt12345"), "kitsu:18");
  assert.equal(cold.getAnimeCanonicalId("mal:62922"), "kitsu:50993");
  assert.equal(cold.getAnilistMalAlias("anilist:425"), "mal:90425");
});
