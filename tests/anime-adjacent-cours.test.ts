// @ts-expect-error Node test types are outside the browser tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are outside the browser tsconfig.
import { readFileSync } from "node:fs";
// @ts-expect-error Node test types are outside the browser tsconfig.
import test from "node:test";
import ts from "typescript";
import { memoryMediaCache } from "./helpers/media-cache.mjs";
import { nextAnimeEntry } from "../src/lib/providers/anime-entry.ts";
import type { AnimeKitsuMeta, AnimeKitsuVideo } from "../src/lib/providers/anime-kitsu-addon.ts";

function video(
  kitsuId: number,
  episode: number,
  imdbEpisode: number,
  imdbSeason = 1,
): AnimeKitsuVideo {
  return {
    id: `kitsu:${kitsuId}:${episode}`,
    title: `Episode ${episode}`,
    season: 1,
    episode,
    imdbSeason,
    imdbEpisode,
    released: "2022-10-01T14:00:00.000Z",
  };
}

const PART_1: AnimeKitsuMeta = {
  id: "kitsu:45398",
  type: "series",
  name: "SPY x FAMILY",
  videos: Array.from({ length: 12 }, (_, i) => video(45398, i + 1, i + 1)),
  links: [
    {
      name: "Sequel: SPY x FAMILY Part 2",
      category: "Franchise",
      url: "stremio:///detail/series/kitsu:45619",
    },
  ],
};

const PART_2: AnimeKitsuMeta = {
  id: "kitsu:45619",
  type: "series",
  name: "SPY x FAMILY Part 2",
  videos: Array.from({ length: 13 }, (_, i) => video(45619, i + 1, i + 13)),
  links: [
    {
      name: "Sequel: SPY x FAMILY Season 2",
      category: "Franchise",
      url: "stremio:///detail/series/kitsu:46873",
    },
  ],
};

const SEASON_2: AnimeKitsuMeta = {
  id: "kitsu:46873",
  type: "series",
  name: "SPY x FAMILY Season 2",
  videos: Array.from({ length: 12 }, (_, i) => video(46873, i + 1, i + 1, 2)),
};

const METAS: Record<string, AnimeKitsuMeta> = {
  "kitsu:45398": PART_1,
  "kitsu:45619": PART_2,
  "kitsu:46873": SEASON_2,
};

function seriesModule() {
  const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(read("src/lib/series-episodes.ts"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const mocks: Record<string, unknown> = {
    "@/lib/media-cache": memoryMediaCache(),
    "@/lib/cache": {
      lruSet: (map: Map<unknown, unknown>, key: unknown, value: unknown) => map.set(key, value),
    },
    "@/lib/memory-profiler": { registerCache() {} },
    "@/lib/safe-fetch": { safeFetch: async () => ({ ok: false }) },
    "./providers/tmdb": {
      applyTmdbEpisodeNames: (eps: unknown) => eps,
      needsTmdbEpisodeNames: () => false,
      tmdbDetails: async () => null,
      tmdbEpisodeNames: async () => new Map(),
      tmdbSeasonEpisodes: async () => [],
    },
    "./providers/tmdb/tmdb-client": {
      tmdbLanguageIso: () => "en",
      effectiveTmdbLanguage: () => "en",
    },
    "./providers/tmdb/tmdb-image-rungs": { tmdbStillUrl: () => undefined },
    "./localized-text": { pickLocalizedText: () => undefined },
    "./meta-resource": {
      PREFERRED_TEXT_SCORE: 0,
      preferCustomMeta: () => false,
      preferredMeta: async () => null,
      preferredVideoMap: () => new Map(),
      preferredVideoName: () => undefined,
      preferredVideoOverview: () => undefined,
      resolveMeta: async () => null,
    },
    "./providers/anime-kitsu-addon": {
      animeKitsuMeta: async (id: string) => METAS[id] ?? null,
    },
    "./providers/anime-mapping": { kitsuToAnilist: async () => null },
    "./providers/anime-entry": {
      resolveAnimeEntry: async (id: string) => {
        const meta = METAS[id];
        return meta ? { kitsuId: Number(id.split(":")[1]), meta } : null;
      },
      nextAnimeEntry: async (id: string) => {
        const meta = METAS[id];
        const sequel = meta?.links?.find(
          (link) => link.category === "Franchise" && link.name.startsWith("Sequel:"),
        );
        const match = sequel ? /\/detail\/series\/([^/?#]+)/.exec(sequel.url) : null;
        if (!match) return null;
        return { id: match[1], meta: METAS[match[1]] ?? null };
      },
    },
    "./providers/kitsu": {
      parseKitsuId: (id: string) => {
        const match = /^kitsu:(\d+)/.exec(id);
        return match ? Number(match[1]) : null;
      },
    },
    "./providers/anizip": {
      aniZipByAnilist: async () => null,
      aniZipByKitsu: async () => null,
      pickEpisodeTitle: (episode: { title?: { en?: string } } | undefined) => episode?.title?.en,
    },
    "./providers/tvdb-proxy": {
      fetchTvdbProxyImages: async () => ({}),
      pickTvdbImage: () => undefined,
    },
    "./providers/anime-franchise-root": { franchiseRoot: async (id: string) => id },
    "./streams/anime-identity": { foreignAnimeProviderSeasons: async () => null },
  };
  const exports: Record<string, any> = {};
  new Function("require", "exports", compiled)((id: string) => {
    assert.ok(Object.hasOwn(mocks, id), `Unexpected dependency: ${id}`);
    return mocks[id];
  }, exports);
  return exports as {
    fetchAdjacentEpisodes: (
      meta: { id: string; type: string; name: string },
      current: { season: number; episode: number },
      opts: {
        tmdbKey: string;
        kitsuStreamId?: string;
        imdbSeason?: number;
        imdbEpisode?: number;
        episodeEndOffset?: number;
        skip?: (season: number, episode: number, metaId?: string) => boolean;
      },
    ) => Promise<{
      prev: { episode: number } | null;
      next: {
        season: number;
        episode: number;
        kitsuStreamId?: string;
        sourceMetaId?: string;
      } | null;
      nextMeta?: { id: string; name: string };
    }>;
  };
}

const meta = (id: string) => ({ id, type: "series", name: id });

test("a Sequel franchise link resolves the next series entry", async () => {
  const lookup = async (id: string) => METAS[id] ?? null;
  const next = await nextAnimeEntry("kitsu:45398", lookup);
  assert.equal(next?.id, "kitsu:45619");
  assert.equal(next?.meta?.name, "SPY x FAMILY Part 2");
  const season = await nextAnimeEntry("kitsu:45619", lookup);
  assert.equal(season?.id, "kitsu:46873");
  assert.equal(await nextAnimeEntry("kitsu:46873", lookup), null);
});

test("the last Part 1 episode advances to Part 2 with its meta", async () => {
  const { fetchAdjacentEpisodes } = seriesModule();
  const result = await fetchAdjacentEpisodes(
    meta("kitsu:45398"),
    { season: 1, episode: 12 },
    { tmdbKey: "", kitsuStreamId: "kitsu:45398:12", imdbSeason: 1, imdbEpisode: 12 },
  );
  assert.equal(result.next?.kitsuStreamId, "kitsu:45619:1");
  assert.equal(result.next?.sourceMetaId, "kitsu:45619");
  assert.equal(result.nextMeta?.id, "kitsu:45619");
  assert.equal(result.nextMeta?.name, "SPY x FAMILY Part 2");
});

test("provider S1E13 starts Part 2 at its entry E1, not the finale", async () => {
  const { fetchAdjacentEpisodes } = seriesModule();
  const result = await fetchAdjacentEpisodes(
    meta("kitsu:45619"),
    { season: 1, episode: 13 },
    { tmdbKey: "", kitsuStreamId: "kitsu:45619:1", imdbSeason: 1, imdbEpisode: 13 },
  );
  assert.equal(result.next?.episode, 2);
  assert.equal(result.next?.kitsuStreamId, "kitsu:45619:2");
  assert.equal(result.nextMeta, undefined);
});

test("provider coordinates alone also find the split-cour entry", async () => {
  const { fetchAdjacentEpisodes } = seriesModule();
  const result = await fetchAdjacentEpisodes(
    meta("kitsu:45619"),
    { season: 1, episode: 13 },
    { tmdbKey: "", imdbSeason: 1, imdbEpisode: 13 },
  );
  assert.equal(result.next?.episode, 2);
  assert.equal(result.next?.kitsuStreamId, "kitsu:45619:2");
});

test("the last Part 2 episode advances to Season 2", async () => {
  const { fetchAdjacentEpisodes } = seriesModule();
  const result = await fetchAdjacentEpisodes(
    meta("kitsu:45619"),
    { season: 1, episode: 13 },
    { tmdbKey: "", kitsuStreamId: "kitsu:45619:13", imdbSeason: 1, imdbEpisode: 25 },
  );
  assert.equal(result.next?.kitsuStreamId, "kitsu:46873:1");
  assert.equal(result.next?.sourceMetaId, "kitsu:46873");
  assert.equal(result.nextMeta?.id, "kitsu:46873");
  assert.equal(result.nextMeta?.name, "SPY x FAMILY Season 2");
});

test("ordinary mid-cour navigation is unchanged", async () => {
  const { fetchAdjacentEpisodes } = seriesModule();
  const result = await fetchAdjacentEpisodes(
    meta("kitsu:45619"),
    { season: 1, episode: 1 },
    { tmdbKey: "", kitsuStreamId: "kitsu:45619:1", imdbSeason: 1, imdbEpisode: 13 },
  );
  assert.equal(result.next?.episode, 2);
  assert.equal(result.nextMeta, undefined);
});

test("a combined finale advances beyond its last episode into the sequel", async () => {
  const { fetchAdjacentEpisodes } = seriesModule();
  const result = await fetchAdjacentEpisodes(
    meta("kitsu:45398"),
    { season: 1, episode: 12 },
    {
      tmdbKey: "",
      kitsuStreamId: "kitsu:45398:11",
      imdbSeason: 1,
      imdbEpisode: 11,
      episodeEndOffset: 1,
    },
  );
  assert.equal(result.next?.kitsuStreamId, "kitsu:45619:1");
  assert.equal(result.nextMeta?.id, "kitsu:45619");
});

test("a combined split-cour file applies its span after resolving provider coordinates", async () => {
  const { fetchAdjacentEpisodes } = seriesModule();
  const result = await fetchAdjacentEpisodes(
    meta("kitsu:45619"),
    { season: 1, episode: 14 },
    { tmdbKey: "", imdbSeason: 1, imdbEpisode: 13, episodeEndOffset: 1 },
  );
  assert.equal(result.next?.kitsuStreamId, "kitsu:45619:3");
});

test("a combined file without identity hints does not apply the end offset twice", async () => {
  const { fetchAdjacentEpisodes } = seriesModule();
  const result = await fetchAdjacentEpisodes(
    meta("kitsu:45398"),
    { season: 1, episode: 12 },
    { tmdbKey: "", episodeEndOffset: 1 },
  );
  assert.equal(result.next?.kitsuStreamId, "kitsu:45619:1");
});

test("a cour without a Sequel link keeps Next disabled", async () => {
  const { fetchAdjacentEpisodes } = seriesModule();
  const result = await fetchAdjacentEpisodes(
    meta("kitsu:46873"),
    { season: 1, episode: 12 },
    { tmdbKey: "", kitsuStreamId: "kitsu:46873:12", imdbSeason: 2, imdbEpisode: 12 },
  );
  assert.equal(result.next, null);
});

test("hidden episodes are checked against the sequel entry during a cour handoff", async () => {
  const { fetchAdjacentEpisodes } = seriesModule();
  const query = { tmdbKey: "", kitsuStreamId: "kitsu:45398:12" };
  const result = await fetchAdjacentEpisodes(
    meta("kitsu:45398"),
    { season: 1, episode: 12 },
    { ...query, skip: (s, e, id = "kitsu:45398") => id === "kitsu:45398" && s === 1 && e === 1 },
  );
  assert.equal(result.next?.kitsuStreamId, "kitsu:45619:1");
  const hiddenSequel = await fetchAdjacentEpisodes(
    meta("kitsu:45398"),
    { season: 1, episode: 12 },
    { ...query, skip: (s, e, id = "kitsu:45398") => id === "kitsu:45619" && s === 1 && e === 1 },
  );
  assert.equal(hiddenSequel.next?.kitsuStreamId, "kitsu:45619:2");
});

test("player navigation switches to the next entry's meta", () => {
  const source = readFileSync(
    new URL("../src/views/player/hooks/use-episode-navigation.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /nextMeta\?\.id === ep\.sourceMetaId/);
  assert.match(source, /openPicker\(targetMeta, carried/);
});
