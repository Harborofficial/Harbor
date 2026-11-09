import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function load(path: string, dependencies: Record<string, unknown>) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports: any = {};
  new Function("require", "exports", compiled)(() => dependencies, exports);
  return exports;
}

function finale(overrides: Record<string, unknown> = {}) {
  return load("../src/lib/player/series-finale.ts", {
    animeSeriesFromStreamId: () => null,
    fetchEpisodeList: async () => [{ season: 1, episode: 12 }],
    fetchSeasonList: async () => [1],
    parseKitsuId: (id: string) => (id.startsWith("kitsu:") ? Number(id.slice(6)) : null),
    kitsuAnime: async () => ({ episodeCount: 12 }),
    kitsuRelated: async () => [],
    tmdbDetails: async () => null,
    ...overrides,
  }).isFinalSeriesEpisode;
}

const meta = { id: "tt123", type: "series", name: "Test" };
const current = { season: 1, episode: 12 };
const opts = { tmdbKey: "" };

test("Mashle S2E12 matches its entry-relative Kitsu stream despite franchise season numbering", async () => {
  const check = finale({
    animeSeriesFromStreamId: () => "kitsu:47671",
    fetchEpisodeList: async () =>
      Array.from({ length: 12 }, (_, i) => ({
        season: 1,
        episode: i + 1,
        kitsuStreamId: `kitsu:47671:${i + 1}`,
        airDate: "2024-03-30",
      })),
    kitsuRelated: async () => [{ role: "sequel", meta: { id: "kitsu:48903" } }],
    kitsuAnime: async () => ({ status: "unreleased", startDate: "2027-01-31" }),
  });
  assert.equal(
    await check(meta, { season: 2, episode: 12, kitsuStreamId: "kitsu:47671:12" }, opts),
    true,
  );
  assert.equal(
    await check(meta, { season: 2, episode: 11, kitsuStreamId: "kitsu:47671:11" }, opts),
    false,
  );
});

test("only the final catalog episode qualifies, including single-episode series", async () => {
  assert.equal(await finale()(meta, current, opts), true);
  assert.equal(await finale()(meta, { season: 1, episode: 11 }, opts), false);
  assert.equal(await finale({ fetchEpisodeList: async () => [] })(meta, current, opts), false);
});

test("upcoming, TBA and released episodes in later seasons block the end screen", async () => {
  for (const airDate of ["2099-01-01", "TBA", "2020-01-01", undefined]) {
    const eps = [current, { season: 2, episode: 1, airDate }];
    assert.equal(
      await finale({ fetchEpisodeList: async () => eps })(meta, current, opts),
      false,
      `S1E12 must not qualify while S2E1 is listed (${airDate ?? "undated"})`,
    );
  }
});

test("the latest aired weekly episode is not the finale when future episodes are listed", async () => {
  const eps = Array.from({ length: 12 }, (_, index) => ({
    season: 1,
    episode: index + 1,
    airDate: index < 6 ? "2026-10-01" : "2099-01-01",
  }));
  const check = finale({ fetchEpisodeList: async () => eps });
  assert.equal(await check(meta, { season: 1, episode: 5 }, opts), false);
  assert.equal(await check(meta, { season: 1, episode: 6 }, opts), false);
  assert.equal(await check(meta, { season: 1, episode: 11 }, opts), false);
  assert.equal(await check(meta, { season: 1, episode: 12 }, opts), true);
});

test("undated later episodes also block a premature finale", async () => {
  const eps = [
    { season: 1, episode: 5, airDate: "2026-10-01" },
    { season: 1, episode: 6, airDate: "TBA" },
    { season: 1, episode: 7 },
  ];
  const check = finale({ fetchEpisodeList: async () => eps });
  assert.equal(await check(meta, { season: 1, episode: 5 }, opts), false);
  assert.equal(await check(meta, { season: 1, episode: 6 }, opts), false);
  assert.equal(await check(meta, { season: 1, episode: 7 }, opts), true);
});

test("Kitsu anime finale permits announced sequels but blocks released sequels", async () => {
  const anime = { ...meta, id: "kitsu:42" };
  assert.equal(await finale()(anime, current, opts), true);
  assert.equal(
    await finale({
      kitsuRelated: async () => [{ role: "sequel", meta: { id: "kitsu:43" } }],
      kitsuAnime: async () => ({ status: "finished" }),
    })(anime, current, opts),
    false,
  );
  assert.equal(
    await finale({
      kitsuRelated: async () => [{ role: "sequel", meta: { id: "kitsu:43" } }],
      kitsuAnime: async () => ({ status: "unreleased" }),
    })(anime, current, opts),
    true,
  );
});

test("Kitsu end-screen recommendations use the anime provider without a TMDB key", async () => {
  let called = 0;
  const items = Array.from({ length: 24 }, (_, i) => ({
    id: `kitsu:${i + 100}`,
    name: `Anime ${i}`,
  }));
  const { loadMoreLikeThis } = load("../src/lib/recommendations.ts", {
    parseKitsuId: () => 42,
    animeRecommendations: async (id: number) => {
      called = id;
      return items;
    },
    cinemetaDetails: () => {
      throw new Error("Unexpected Cinemeta request");
    },
    tmdbDetails: () => {
      throw new Error("Unexpected TMDB request");
    },
  });
  assert.deepEqual(await loadMoreLikeThis({ id: "kitsu:42" }, null), items.slice(0, 18));
  assert.equal(called, 42);
});
