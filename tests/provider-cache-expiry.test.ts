// @ts-expect-error Node test types are outside the browser tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are outside the browser tsconfig.
import { readFileSync } from "node:fs";
// @ts-expect-error Node test types are outside the browser tsconfig.
import test from "node:test";
import ts from "typescript";

function load(path: string, mocks: Record<string, unknown>) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports: Record<string, any> = {};
  new Function("require", "exports", compiled)((id: string) => {
    assert.ok(id in mocks, `Unexpected dependency: ${id}`);
    return mocks[id];
  }, exports);
  return exports;
}

function mockAniZip(options: {
  read?: (key: string) => Promise<any>;
  write?: (row: any) => void;
  fetch?: () => Promise<any>;
  aliases?: string[];
}) {
  const stored = new Map<string, any>();
  let fetches = 0;
  const aliases = options.aliases ?? [];
  const api = load("src/lib/providers/anizip.ts", {
    "@/lib/safe-fetch": {
      safeFetch: async () => {
        fetches++;
        return options.fetch
          ? options.fetch()
          : { ok: true, json: async () => ({ mappings: { kitsu_id: 42 } }) };
      },
    },
    "@/lib/anime-cw-ids": {
      recordAnimeCwId: (a: string) => aliases.push(a),
      recordAnilistMalAlias: () => {},
    },
    "@/lib/anime-identity-db": {
      animeDbReadProvider: async (key: string) =>
        options.read ? options.read(key) : (stored.get(key) ?? null),
      animeDbWriteProvider: async (row: any) => {
        stored.set(row.key, row);
        options.write?.(row);
        return true;
      },
      animeDbWriteEntries: async () => true,
      animeDbWriteEpisodes: async () => true,
    },
  });
  return { api, stored, aliases, fetches: () => fetches };
}

test("AniZip incomplete memory entries expire and persisted complete hits retain TTL and restore exact aliases", async () => {
  const realNow = Date.now;
  let now = 1_800_000_000_000;
  Date.now = () => now;
  try {
    const { api, fetches } = mockAniZip({
      fetch: async () => ({
        ok: true,
        json: async () => ({ mappings: { kitsu_id: 42 }, episodes: {} }),
      }),
    });
    await api.aniZipByKitsu(42);
    assert.equal(fetches(), 1);
    await api.aniZipByKitsu(42);
    assert.equal(fetches(), 1, "fresh incomplete memory result is reused");
    now += 24 * 60 * 60 * 1000 + 1;
    await api.aniZipByKitsu(42);
    assert.equal(fetches(), 2, "incomplete memory result expires after one day");

    const complete = mockAniZip({
      fetch: async () => ({
        ok: true,
        json: async () => ({
          mappings: { kitsu_id: 43, thetvdb_id: 430 },
          episodes: { "1": { episodeNumber: 1, airDate: "2010-01-01" } },
        }),
      }),
    });
    await complete.api.aniZipByKitsu(43);
    now += 29 * 24 * 60 * 60 * 1000;
    await complete.api.aniZipByKitsu(43);
    assert.equal(
      complete.fetches(),
      1,
      "complete positive memory result remains fresh inside its 30-day TTL",
    );

    const ttl = 30 * 24 * 60 * 60 * 1000;
    let writes = 0;
    const {
      api: persisted,
      fetches: diskFetches,
      aliases: diskAliases,
    } = mockAniZip({
      write: () => {
        writes++;
      },
      read: async (key) =>
        key === "anizip:kitsu_id=9"
          ? {
              value: { mappings: { kitsu_id: 9, anilist_id: 90, mal_id: 900, anidb_id: 9000 } },
              expiresAt: now + ttl,
              fetchedAt: now,
            }
          : null,
    });
    await persisted.aniZipByKitsu(9);
    assert.equal(diskFetches(), 0);
    assert.equal(
      writes,
      0,
      "restoring aliases from disk does not rewrite and extend the stored TTL",
    );
    assert.deepEqual(diskAliases.sort(), ["anidb:9000", "anilist:90", "mal:900"].sort());
  } finally {
    Date.now = realNow;
  }
});

test("an expired positive AniZip mapping survives a failed refresh", async () => {
  const realNow = Date.now;
  const now = 1_800_000_000_000;
  Date.now = () => now;
  try {
    const stale = { mappings: { kitsu_id: 99 } };
    const read = async () => ({ value: stale, expiresAt: now - 1, fetchedAt: now - 86_400_000 });
    for (const fetch of [
      async () => {
        throw new Error("offline");
      },
      async () => ({ ok: false, status: 500 }),
    ]) {
      const { api, fetches } = mockAniZip({ fetch, read });
      assert.deepEqual(await api.aniZipByKitsu(99), stale);
      assert.equal(fetches(), 1);
    }
  } finally {
    Date.now = realNow;
  }
});

test("AniZip 404 memory and disk negative results expire at their stored deadlines", async () => {
  const realNow = Date.now;
  let now = 1_800_000_000_000;
  Date.now = () => now;
  try {
    let reads = 0;
    let persisted: any = null;
    const { api, fetches } = mockAniZip({
      read: async () => {
        reads++;
        return persisted;
      },
      write: (row) => {
        persisted = row;
      },
      fetch: async () => ({ ok: false, status: 404 }),
    });
    assert.equal(await api.aniZipByKitsu(1), null);
    assert.equal(await api.aniZipByKitsu(1), null);
    assert.equal(fetches(), 1);
    now += 120_001;
    await api.aniZipByKitsu(1);
    assert.equal(reads, 2, "expired memory entry rechecks disk negative");
    assert.equal(fetches(), 1, "the six-hour persisted 404 remains valid");

    now += 120_001;
    let diskReads = 0;
    const { api: disk, fetches: diskFetches } = mockAniZip({
      read: async () => {
        diskReads++;
        return { value: null, expiresAt: now + 1000, fetchedAt: now };
      },
    });
    assert.equal(await disk.aniZipByKitsu(2), null);
    assert.equal(await disk.aniZipByKitsu(2), null);
    assert.equal(diskReads, 1, "disk negative is retained in memory until its expiry");
    assert.equal(diskFetches(), 0);
    now += 1001;
    await disk.aniZipByKitsu(2);
    assert.equal(diskReads, 2, "expired disk negative is checked again");
  } finally {
    Date.now = realNow;
  }
});

test("cold concurrent AniDB XML lookups share hydration and return the fetched map", async () => {
  let release!: (value: any) => void;
  const held = new Promise<any>((resolve) => {
    release = resolve;
  });
  let reads = 0;
  let fetches = 0;
  const api = load("src/lib/providers/anime-mapping.ts", {
    "@/lib/providers/anizip": {},
    "@/lib/providers/kitsu": {},
    "@/lib/streams/anime-identity-core": { selectSiblingWindows: () => [] },
    "./kitsu-mapping": { kitsuExternalIds: async () => null },
    "./mapping-store": {
      mappingStore: () => ({ ready: Promise.resolve(), get: () => undefined, set: () => {} }),
    },
    "@/lib/anime-identity-db": {
      animeDbReadProvider: async () => {
        reads++;
        return held;
      },
      animeDbWriteProvider: async () => true,
    },
  });
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    fetches++;
    return {
      ok: true,
      text: async () =>
        '<anime anidbid="77" tvdbid="888" imdbid="tt1234567" defaulttvdbseason="1" />',
    } as any;
  }) as any;
  try {
    const one = api.loadAnidbMaps();
    const two = api.loadAnidbMaps();
    release(null);
    const [a, b] = await Promise.all([one, two]);
    assert.equal(reads, 1);
    assert.equal(fetches, 1);
    assert.equal(a.tvdb["77"], 888);
    assert.deepEqual(b.tvdb, a.tvdb);
  } finally {
    globalThis.fetch = realFetch;
  }
});
