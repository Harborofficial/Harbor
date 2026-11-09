// @ts-expect-error Node test types are outside the browser tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are outside the browser tsconfig.
import { readFileSync } from "node:fs";
// @ts-expect-error Node test types are outside the browser tsconfig.
import test from "node:test";
// @ts-expect-error Node test types are outside the browser tsconfig.
import ts from "typescript";

function harness({
  native = null,
  mapping = 81,
  videos = [] as any[] | ((id: string) => any[]),
  tracker,
  tmdbImdb = null,
}: {
  native?: number | null;
  mapping?: number | null;
  videos?: any[] | ((id: string) => any[]);
  tracker?: (id: string, coords: any) => Promise<any>;
  tmdbImdb?: string | null;
} = {}) {
  const calls = { entry: 0, meta: 0, mapping: 0, tracker: 0 };
  const animeIds = new Map<string, string>();
  const provider = new Map<string, any>();
  const exports: Record<string, any> = {};
  const source = readFileSync(new URL("../src/lib/cw-anime-identity.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const mocks: Record<string, any> = {
    "@/lib/anime-cw-ids": {
      getAnimeCanonicalId: (id: string) => animeIds.get(id) ?? null,
      getAnimeCwId: (id: string) => animeIds.get(id) ?? null,
      getAnilistMalAlias: () => null,
      recordAnimeCwId: (id: string, value: string) => animeIds.set(id, value),
      notifyAnimeCwIds: () => {},
    },
    "@/lib/anime-identity-db": {
      animeDbReadEntry: async () => null,
      animeDbReadProvider: async (key: string) => provider.get(key) ?? null,
      animeDbWriteProvider: async (record: any) => {
        provider.set(record.key, record);
        return true;
      },
    },
    "@/lib/providers/anime-entry": {
      resolveAnimeEntry: async () => {
        calls.entry++;
        return native ? { kitsuId: native, meta: null } : null;
      },
    },
    "@/lib/providers/anime-kitsu-addon": {
      animeKitsuMeta: async (id: string) => {
        calls.meta++;
        return { id, videos: typeof videos === "function" ? videos(id) : videos };
      },
    },
    "@/lib/anime-tracker-entry": {
      resolveTrackerAnimeEntry: async (id: string, coords: any) => {
        calls.tracker++;
        return tracker
          ? tracker(id, coords)
          : mapping == null
            ? null
            : { id: `kitsu:${mapping}`, episode: coords.episode, baseId: `kitsu:${mapping}` };
      },
    },
    "@/lib/providers/tmdb/tmdb-imdb-resolve": {
      tmdbImdbCached: () => null,
      tmdbImdbId: async () => tmdbImdb,
    },
    "@/lib/publicmetadb/mappings": {
      getImdbForTmdb: async () => tmdbImdb,
    },
  };
  new Function("require", "exports", compiled)((id: string) => {
    assert.ok(id in mocks, `Unexpected dependency: ${id}`);
    return mocks[id];
  }, exports);
  return { api: exports, calls, provider };
}

test("cold native addon resolution warms MAL to its Kitsu entry", async () => {
  const h = harness({ native: 551 });
  await h.api.warmCwAnimeIdentities([{ _id: "mal:42" }]);
  assert.equal(h.api.cwAnimeIdentityKey("mal:42"), "kitsu:551");
  assert.equal(h.calls.entry, 1);
});

test("catalog checkpoint grouping requires exact addon IMDb id and explicit provider coordinates", async () => {
  const h = harness({
    videos: [
      { id: "kitsu:81:4", imdb_id: "tt100", imdbSeason: 2, imdbEpisode: 4 },
      { id: "kitsu:81:99", imdb_id: "tt100", imdbSeason: 0, imdbEpisode: 1 },
      { id: "kitsu:81:5", imdb_id: "tt200", imdbSeason: 2, imdbEpisode: 5 },
      { id: "kitsu:81:4", imdb_id: "tt100", season: 2, episode: 4 },
    ],
  });
  const good = { _id: "tt100", imdb_id: "tt100", videoId: "tt100:2:4", season: 2, episode: 4 };
  const wrongSeason = { ...good, season: 1 };
  const special = { ...good, season: 0, episode: 1 };
  const wrongImdb = { ...good, _id: "tt200", imdb_id: "tt200" };
  await h.api.warmCwAnimeIdentities([good, wrongSeason, special, wrongImdb]);
  assert.equal(
    h.api.cwAnimeIdentityKey("tt100", good.videoId, { ...good, imdbId: good.imdb_id }),
    "kitsu:81",
  );
  assert.equal(
    h.api.cwAnimeIdentityKey("tt100", wrongSeason.videoId, {
      ...wrongSeason,
      imdbId: wrongSeason.imdb_id,
    }),
    null,
  );
  assert.equal(
    h.api.cwAnimeIdentityKey("tt100", special.videoId, { ...special, imdbId: special.imdb_id }),
    null,
  );
  assert.equal(
    h.api.cwAnimeIdentityKey("tt200", wrongImdb.videoId, {
      ...wrongImdb,
      imdbId: wrongImdb.imdb_id,
    }),
    null,
  );
});

test("different checkpoint snapshots for the same catalog show resolve concurrently", async () => {
  const h = harness({
    videos: [
      { imdb_id: "tt300", imdbSeason: 1, imdbEpisode: 2 },
      { imdb_id: "tt300", imdbSeason: 2, imdbEpisode: 1 },
    ],
  });
  const a = { _id: "tt300", imdb_id: "tt300", videoId: "tt300:1:2", season: 1, episode: 2 };
  const b = { ...a, videoId: "tt300:2:1", season: 2, episode: 1 };
  await Promise.all([h.api.warmCwAnimeIdentities([a]), h.api.warmCwAnimeIdentities([b])]);
  assert.equal(
    h.api.cwAnimeIdentityKey("tt300", a.videoId, { ...a, imdbId: a.imdb_id }),
    "kitsu:81",
  );
  assert.equal(
    h.api.cwAnimeIdentityKey("tt300", b.videoId, { ...b, imdbId: b.imdb_id }),
    "kitsu:81",
  );
});

test("a provider video naming a different entry cannot prove the candidate cour", async () => {
  const h = harness({
    videos: [{ id: "kitsu:999:4", imdb_id: "tt100", imdbSeason: 2, imdbEpisode: 4 }],
  });
  const item = { _id: "tt100", videoId: "tt100:2:4", season: 2, episode: 4 };
  await h.api.warmCwAnimeIdentities([item]);
  assert.equal(h.api.cwAnimeIdentityKey(item._id, item.videoId, item), null);
});

test("failed warm results use a retry TTL, then retry after expiry", async () => {
  const h = harness({ tracker: async () => null });
  const originalNow = Date.now;
  let now = originalNow();
  Date.now = () => now;
  try {
    const item = { _id: "tt400", imdb_id: "tt400", season: 1, episode: 1 };
    await h.api.warmCwAnimeIdentities([item]);
    await h.api.warmCwAnimeIdentities([item]);
    assert.equal(h.calls.tracker, 1);
    now += 61_000;
    await h.api.warmCwAnimeIdentities([item]);
    assert.equal(h.calls.tracker, 2);
  } finally {
    Date.now = originalNow;
  }
});

test("season-aware resolver selects a sequel entry when the ID-only root mapping is S1", async () => {
  const h = harness({
    mapping: 81,
    tracker: async (_id, coords) => ({
      id: coords.season === 2 ? "kitsu:82" : "kitsu:81",
      episode: coords.episode,
      baseId: "kitsu:81",
    }),
    videos: (id) =>
      id === "kitsu:82"
        ? [{ imdb_id: "tt700", imdbSeason: 2, imdbEpisode: 1 }]
        : [{ imdb_id: "tt700", imdbSeason: 1, imdbEpisode: 1 }],
  });
  const s2 = { _id: "tt700", videoId: "tt700:2:1" };
  await h.api.warmCwAnimeIdentities([s2]);
  assert.equal(h.api.cwAnimeIdentityKey("tt700", s2.videoId), "kitsu:82");
  assert.equal(h.calls.tracker, 1);
  assert.equal(h.calls.meta, 1);
});

test("a fresh persisted exact snapshot proof avoids provider calls", async () => {
  const first = harness({ videos: [{ imdb_id: "tt500", imdbSeason: 3, imdbEpisode: 2 }] });
  const item = { _id: "tt500", imdb_id: "tt500", videoId: "tt500:3:2", season: 3, episode: 2 };
  await first.api.warmCwAnimeIdentities([item]);
  const second = harness({ videos: [] });
  for (const [key, value] of first.provider) second.provider.set(key, value);
  await second.api.warmCwAnimeIdentities([item]);
  assert.equal(
    second.api.cwAnimeIdentityKey("tt500", item.videoId, { ...item, imdbId: item.imdb_id }),
    "kitsu:81",
  );
  assert.equal(second.calls.mapping, 0);
  assert.equal(second.calls.meta, 0);
});

test("a TMDB catalog row uses an IMDb alias as its exact source identity", async () => {
  const h = harness({
    videos: [{ id: "kitsu:81:4", imdb_id: "tt100", imdbSeason: 1, imdbEpisode: 4 }],
  });
  const item = {
    _id: "tmdb:tv:55",
    altIds: ["tt100"],
    videoId: "tmdb:tv:55:1:4",
    season: 1,
    episode: 4,
  };
  await h.api.warmCwAnimeIdentities([item]);
  assert.equal(
    h.api.cwAnimeIdentityKey("tmdb:tv:55", item.videoId, {
      season: 1,
      episode: 4,
      imdbId: "tt100",
    }),
    "kitsu:81",
  );
});

test("a TMDB catalog row can discover its IMDb identity for proof", async () => {
  const h = harness({
    tmdbImdb: "tt100",
    videos: [{ id: "kitsu:81:4", imdb_id: "tt100", imdbSeason: 1, imdbEpisode: 4 }],
  });
  const item = {
    _id: "tmdb:tv:55",
    videoId: "tmdb:tv:55:1:4",
    season: 1,
    episode: 4,
  };
  await h.api.warmCwAnimeIdentities([item], { tmdbKey: "key" });
  assert.equal(h.api.getCachedCatalogImdb("tmdb:tv:55"), "tt100");
  const merged = h.api.dedupeAnimeCw([
    item,
    { _id: "kitsu:81", state: { season: 1, episode: 4, video_id: "kitsu:81:4" } },
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0]._id, "tmdb:tv:55");
});

test("merged checkpoints preserve same-ID sources with distinct coordinates and progress", () => {
  const h = harness();
  const first = {
    _id: "tt600",
    external: "simkl",
    state: { season: 1, episode: 2, video_id: "tt600:1:2", timeOffset: 100 },
  };
  const second = {
    _id: "tt600",
    external: "local",
    state: { season: 2, episode: 1, video_id: "tt600:2:1", timeOffset: 800 },
  };
  const merged = h.api.dedupeAnimeCw([first, second]);
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0].cwMembers, [first, second]);
});
