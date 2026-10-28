// @ts-expect-error Node test types are outside the browser tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are outside the browser tsconfig.
import { readFileSync } from "node:fs";
// @ts-expect-error Node test types are outside the browser tsconfig.
import test from "node:test";
import ts from "typescript";

function load(path: string, mocks: Record<string, unknown>): any {
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

const tougenVideos = [1, 2, 3, 4, 5].map((episode) => ({
  id: `kitsu:51018:${episode}`,
  title: `Episode ${episode}`,
  released: `2026-10-${String(2 + (episode - 1) * 7).padStart(2, "0")}T14:30:00.000Z`,
  season: 1,
  episode,
  imdb_id: "tt32344704",
  imdbSeason: 2,
  imdbEpisode: episode,
}));

function seriesModule(overrides: Record<string, unknown> = {}) {
  let externalCalls = 0;
  const directMeta = {
    id: "kitsu:51018",
    name: "Tougen Anki: Nikko Kegon Falls Arc",
    imdb_id: "tt32344704",
    videos: tougenVideos,
  };
  const addon = {
    animeKitsuMeta: async (id: string) => (id === "mal:63181" ? directMeta : null),
  };
  const mapping = {
    externalToKitsu: async () => {
      externalCalls += 1;
      return null;
    },
    kitsuToAnilist: async () => null,
  };
  const kitsu = {
    parseKitsuId: (id: string) => {
      const m = /^kitsu:(\d+)/.exec(id);
      return m ? Number(m[1]) : null;
    },
  };
  const entry = load("src/lib/providers/anime-entry.ts", {
    "@/lib/providers/anime-kitsu-addon": addon,
    "@/lib/providers/anime-mapping": mapping,
    "@/lib/providers/kitsu": kitsu,
  });
  const deps: Record<string, unknown> = {
    "@/lib/cache": {
      lruSet: (map: Map<unknown, unknown>, key: unknown, value: unknown) => map.set(key, value),
    },
    "@/lib/memory-profiler": { registerCache() {} },
    "@/lib/media-cache": {
      onMediaCacheClear() {},
      mediaCacheGeneration: () => 0,
      MEDIA_TTL: {
        recent: 60 * 60_000,
        episodes: 12 * 60 * 60_000,
        settled: 7 * 24 * 60 * 60_000,
        stale: 30 * 24 * 60 * 60_000,
      },
    },
    "@/lib/safe-fetch": {
      safeFetch: async () => {
        throw new Error("unexpected live request");
      },
    },
    "./meta-resource": {
      PREFERRED_TEXT_SCORE: 1000,
      preferCustomMeta: () => false,
      preferredMeta: async () => null,
      preferredVideoMap: () => new Map(),
      preferredVideoName: () => undefined,
      preferredVideoOverview: () => undefined,
      resolveMeta: async () => null,
    },
    "./providers/tmdb": {
      applyTmdbEpisodeNames: (eps: unknown[]) => eps,
      needsTmdbEpisodeNames: () => false,
      tmdbDetails: async () => null,
      tmdbEpisodeNames: async () => null,
      tmdbSeasonEpisodes: async () => [],
    },
    "./providers/tmdb/tmdb-client": {
      effectiveTmdbLanguage: () => "en",
      tmdbLanguageIso: () => "en",
    },
    "./providers/tmdb/tmdb-image-rungs": { tmdbStillUrl: () => undefined },
    "./localized-text": { pickLocalizedText: () => undefined },
    "./providers/anime-kitsu-addon": addon,
    "./providers/anime-entry": entry,
    "./providers/anime-mapping": mapping,
    "./providers/kitsu": kitsu,
    "./providers/anizip": {
      aniZipByAnilist: async () => null,
      aniZipByKitsu: async () => null,
      pickEpisodeTitle: () => null,
    },
    "./providers/tvdb-proxy": {
      fetchTvdbProxyImages: async () => ({}),
      pickTvdbImage: () => undefined,
    },
    "./providers/anime-franchise-root": { franchiseRoot: async (id: string) => id },
    "./streams/anime-identity": { foreignAnimeProviderSeasons: async () => null },
    ...overrides,
  };
  const module = load("src/lib/series-episodes.ts", deps);
  return { module, externalCalls: () => externalCalls };
}

test("a direct addon mapping keeps the sequel's own episode list", async () => {
  const h = seriesModule();
  const list = await h.module.fetchEpisodeList(
    { id: "mal:63181", type: "series", name: "Tougen Anki: Nikko Kegon Falls Arc" },
    { tmdbKey: "" },
  );
  assert.equal(list.length, 5);
  assert.equal(list[3].episode, 4);
  assert.equal(list[3].imdbSeason, 2);
  assert.equal(list[3].imdbEpisode, 4);
  assert.equal(list[3].airDate, "2026-10-23T14:30:00.000Z");
  // The stale external-id cache must not be consulted when the anime addon
  // already knows the entry, or the list can fall back to the parent cour.
  assert.equal(h.externalCalls(), 0);
});

test("the external mapping is still used when the addon cannot resolve the id", async () => {
  const h = seriesModule();
  const list = await h.module.fetchEpisodeList(
    { id: "mal:50000", type: "series", name: "Fixture" },
    { tmdbKey: "" },
  );
  assert.equal(list.length, 0);
  assert.equal(h.externalCalls(), 1);
});

test("the anime overview resolves the addon entry before the external graph", () => {
  const src = readFileSync(
    new URL("../src/lib/providers/anime-detail.ts", import.meta.url),
    "utf8",
  );
  assert.match(src, /const entry = await resolveAnimeEntry\(meta\.id\)/);
  assert.doesNotMatch(src, /kitsuId = await externalToKitsu\(source, n\)/);
  assert.match(src, /directMeta &&[\s\S]*?parseKitsuId\(directMeta\.id\) === kitsuId/);
});

test("a cached miss is retried after the short negative TTL", async () => {
  let fetches = 0;
  let stored: { kitsu: number | null; t: number } | null = {
    kitsu: null,
    t: Date.now() - 7 * 60 * 60 * 1000,
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    fetches += 1;
    return { ok: true, json: async () => ({ kitsu: 51018 }) } as Response;
  }) as typeof fetch;
  try {
    const module = load("src/lib/providers/anime-mapping.ts", {
      "@/lib/providers/anizip": {
        aniZipByAnidb: async () => null,
        aniZipByAnilist: async () => null,
        aniZipByImdb: async () => null,
        aniZipByKitsu: async () => null,
        aniZipByMal: async () => null,
        aniZipByTmdbTv: async () => null,
      },
      "@/lib/providers/kitsu": {
        kitsuAnime: async () => null,
        kitsuMainTvSeries: async () => null,
        kitsuRelated: async () => [],
        parseKitsuId: () => null,
      },
      "@/lib/streams/anime-identity-core": { selectSiblingWindows: () => [] },
      "./mapping-store": {
        mappingStore: (key: string) => ({
          get: () => (key === "harbor.extkitsucache.v2" ? stored : undefined),
          set: (_key: string, value: { kitsu: number | null; t: number }) => {
            stored = value;
          },
        }),
      },
    });
    assert.equal(await module.externalToKitsu("myanimelist", 63181), 51018);
    assert.equal(fetches, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
