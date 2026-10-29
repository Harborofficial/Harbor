import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

function loadModule(file, dependencies) {
  const module = { exports: {} };
  const source = ts.transpileModule(
    readFileSync(new URL(`../src/lib/${file}`, import.meta.url), "utf8"),
    {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    },
  ).outputText;
  vm.runInNewContext(source, {
    module,
    exports: module.exports,
    AbortController,
    AbortSignal,
    URL,
    TextDecoder,
    TextEncoder,
    setTimeout,
    clearTimeout,
    require(name) {
      assert.ok(name in dependencies, `Unexpected import ${name}`);
      return dependencies[name];
    },
  });
  return module.exports;
}

test("addon seasons supply names, synopses, posters and backdrops", async () => {
  const full = {
    id: "tt123",
    type: "series",
    name: "Test show",
    _tmdbId: "42",
    seasons: [
      {
        season: 1,
        name: "First",
        overview: "First season",
        overviewLanguage: "en",
        poster: "https://addon.test/s1.jpg",
        background: "https://addon.test/s1-bg.jpg",
      },
    ],
    seasonPosters: { 2: "https://addon.test/s2.jpg" },
    app_extras: {
      seasonPosters: { 3: "https://addon.test/s3.jpg" },
      seasonOverviews: { 3: "Third season" },
      seasonBackdrops: { 3: "https://addon.test/s3-bg.jpg" },
    },
    videos: [
      { season: 1, episode: 1, released: "2020-01-01" },
      { season: 1, episode: 2 },
      { season: 2, episode: 1 },
    ],
  };
  const f = loadModule("providers/cinemeta-details.ts", {
    "@/lib/safe-fetch": { safeFetch: async () => ({ ok: false }) },
    "@/lib/metadata-policy": { addonOnlyMetadata: () => false },
    "@/lib/meta-resource": { preferCustomMeta: () => true, resolveMeta: async () => full },
    "@/lib/auth": { readActiveStremioAuthKey: () => null },
    "@/lib/cinemeta": { topMovies: async () => [], topSeries: async () => [] },
    "@/lib/maintenance": { registerEvictable: () => {} },
    "@/lib/season-name": {
      isGenericSeasonName: (name, number) => name === `Season ${number}`,
    },
  });

  const detail = await f.cinemetaDetails({ id: "tt123", type: "series", name: "Test show" });
  assert.equal(detail.id, 42);
  assert.equal(detail.tmdbTvId, 42);
  assert.equal(detail.numberOfSeasons, 3);
  assert.equal(detail.numberOfEpisodes, 3);
  assert.deepEqual(
    JSON.parse(
      JSON.stringify(
        detail.seasons.map((season) => [season.seasonNumber, season.name, season.overview]),
      ),
    ),
    [
      [1, "First", "First season"],
      [2, "Season 2", ""],
      [3, "Season 3", "Third season"],
    ],
  );
  assert.equal(detail.seasons[0].episodeCount, 2);
  assert.equal(detail.seasons[0].airDate, "2020-01-01");
  assert.equal(detail.seasonPosters[1], "https://addon.test/s1.jpg");
  assert.equal(detail.seasonPosters[2], "https://addon.test/s2.jpg");
  assert.equal(detail.seasonPosters[3], "https://addon.test/s3.jpg");
  assert.equal(detail.seasonBackdrops[1], "https://addon.test/s1-bg.jpg");
  assert.equal(detail.seasonBackdrops[3], "https://addon.test/s3-bg.jpg");
});

test("addon-only permits a configured TMDB season synopsis request", async () => {
  const requests = [];
  const client = loadModule("providers/tmdb/tmdb-client.ts", {
    "@/lib/metadata-policy": { addonOnlyMetadata: () => true },
    "@/lib/safe-fetch": {
      safeFetch: async (url) => {
        requests.push(url);
        return {
          ok: true,
          status: 200,
          arrayBuffer: async () =>
            new TextEncoder().encode(JSON.stringify({ translations: [] })).buffer,
        };
      },
    },
    "@/lib/request-scheduler": {
      createRequestScheduler: () => ({ schedule: (_key, work) => work(), pauseFor() {} }),
    },
    "./tmdb-catalog-cache": {
      createCatalogCache: () => ({ get: () => undefined, set() {} }),
      isCatalogPath: () => false,
    },
    "@/lib/cache": { lruSet() {} },
    "@/lib/media-cache": {
      cachedMedia: (_type, _key, work) => work(),
      metadataCacheTtl: () => 60_000,
      MEDIA_TTL: { recent: 60_000 },
    },
  });

  assert.equal(await client.get("", "tv/1/season/1/translations"), null);
  assert.equal(requests.length, 0);
  const result = await client.get("key", "tv/1/season/1/translations");
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { translations: [] });
  assert.equal(requests.length, 1);
});

test("lower-priority addons fill missing season fields without replacing the preferred ones", () => {
  const f = loadModule("metadata-addons.ts", {
    "./addon-configuration-key": { addonConfigurationKey: () => undefined },
    "./addons-store/reorder": {
      applyOrderToItems: (items) => [...items],
      loadDisplayOrder: () => [],
    },
  });
  const merged = f.fillMissingMetadata(
    {
      id: "tt1",
      type: "series",
      name: "Preferred",
      seasons: [{ season: 1, name: "Preferred season", poster: "preferred.jpg" }],
      seasonPosters: { 1: "preferred.jpg" },
    },
    {
      id: "tt1",
      type: "series",
      name: "Fallback",
      seasons: [
        { season: 1, overview: "Fallback synopsis" },
        { season: 2, overview: "Second" },
      ],
      seasonPosters: { 1: "fallback.jpg", 2: "fallback-2.jpg" },
    },
  );
  assert.equal(merged.seasons[0].name, "Preferred season");
  assert.equal(merged.seasons[0].overview, "Fallback synopsis");
  assert.equal(merged.seasons[0].poster, "preferred.jpg");
  assert.equal(merged.seasons[1].overview, "Second");
  assert.equal(merged.seasonPosters[1], "preferred.jpg");
  assert.equal(merged.seasonPosters[2], "fallback-2.jpg");
});
