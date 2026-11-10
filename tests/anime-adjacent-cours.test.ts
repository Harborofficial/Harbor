// @ts-expect-error Node test types are outside the browser tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are outside the browser tsconfig.
import { readFileSync } from "node:fs";
// @ts-expect-error Node test types are outside the browser tsconfig.
import test from "node:test";
import ts from "typescript";
import { memoryMediaCache } from "./helpers/media-cache.mjs";
import { nextAnimeEntry, previousAnimeEntry } from "../src/lib/providers/anime-entry.ts";
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

const SPECIALS: AnimeKitsuMeta = {
  id: "kitsu:90001",
  type: "series",
  name: "Specials fixture",
  videos: [
    {
      id: "kitsu:90001:1",
      title: "Special 1",
      season: 0,
      episode: 1,
      imdbSeason: 0,
      imdbEpisode: 1,
      released: "2022-10-01T14:00:00.000Z",
    },
    video(90001, 1, 1),
  ],
};

const ANIZIP_SPECIAL_META: AnimeKitsuMeta = {
  id: "kitsu:90002",
  type: "series",
  name: "AniZip special fixture",
  videos: [video(90002, 1, 1)],
};

const ANIZIP_SPECIAL = {
  mappings: { imdb_id: "tt1234567" },
  episodes: {
    "1": { seasonNumber: 1, episodeNumber: 1 },
    "13": {
      seasonNumber: 0,
      episodeNumber: 1,
      airDate: "2022-10-01",
      title: { en: "Special" },
    },
  },
};

const METAS: Record<string, AnimeKitsuMeta> = {
  "kitsu:45398": PART_1,
  "kitsu:45619": PART_2,
  "kitsu:46873": SEASON_2,
  "kitsu:90001": SPECIALS,
  "kitsu:90002": ANIZIP_SPECIAL_META,
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
    "./providers/anime-mapping": {
      kitsuToAnilist: async () => null,
      animeMappingByKitsu: async (id: number) => (id === 90002 ? ANIZIP_SPECIAL : null),
    },
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
      kitsuEpisodes: async () => [],
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
    "./providers/tvdb-order": { fetchTvdbOrder: async () => null },
    "./providers/tvdb": { tvdbLangFromIso1: () => "en" },
  };
  const exports: Record<string, any> = {};
  new Function("require", "exports", compiled)((id: string) => {
    if (id === "@/lib/metadata-policy" || id === "./metadata-policy")
      return { addonOnlyMetadata: () => false };
    if (id === "./metadata-addons") return { readMetadataAddonOrder: () => [] };
    if (id === "./metadata-sources")
      return { addonKeyFromSource: () => null, normalizeMetadataSourceChain: () => [] };
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
    fetchSeasonList: (
      meta: { id: string; type: string; name: string },
      opts: Record<string, unknown>,
    ) => Promise<number[]>;
    fetchSeasonEpisodes: (
      meta: { id: string; type: string; name: string },
      season: number,
      opts: Record<string, unknown>,
    ) => Promise<Array<{ season: number; episode: number; imdbEpisode?: number }>>;
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

test("a Prequel franchise link resolves the previous series entry", async () => {
  const byId: Record<string, AnimeKitsuMeta> = {
    "kitsu:45619": {
      ...PART_2,
      links: [
        {
          name: "Prequel: SPY x FAMILY",
          category: "Franchise",
          url: "stremio:///detail/series/kitsu:45398",
        },
      ],
    },
    "kitsu:45398": PART_1,
  };
  const previous = await previousAnimeEntry("kitsu:45619", async (id) => byId[id] ?? null);
  assert.equal(previous?.id, "kitsu:45398");
  assert.equal(previous?.meta?.name, "SPY x FAMILY");
});

test("anime specials stay in season 0 for the player season browser", async () => {
  const { fetchSeasonEpisodes, fetchSeasonList } = seriesModule();
  const meta = { id: "kitsu:90001", type: "series", name: "Specials fixture" };
  assert.deepEqual(await fetchSeasonList(meta, {}), [0, 1]);
  const episodes = await fetchSeasonEpisodes(meta, 0, {});
  assert.equal(episodes.length, 1);
  assert.equal(episodes[0].season, 0);
  assert.equal(episodes[0].episode, 1);
});

test("an anime special in AniZip is added even when the Kitsu addon omits it", async () => {
  const { fetchSeasonEpisodes, fetchSeasonList } = seriesModule();
  const meta = { id: "kitsu:90002", type: "series", name: "AniZip special fixture" };
  assert.deepEqual(await fetchSeasonList(meta, {}), [0, 1]);
  const episodes = await fetchSeasonEpisodes(meta, 0, {});
  assert.equal(episodes.length, 1);
  assert.equal(episodes[0].season, 0);
  assert.equal(episodes[0].episode, 13);
  assert.equal(episodes[0].imdbEpisode, 1);
});

test("the player panel browses anime entries and plays with the entry meta", () => {
  const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const panel = read("src/components/player/episode-panel/index.tsx");
  assert.match(panel, /useAnimeEntryBrowser\(meta, currentEpisode, open\)/);
  assert.match(panel, /entryBrowser\.browsing \? entryBrowser\.activeMeta : null/);
  assert.match(panel, /const playbackMeta = entryBrowser\.activeMeta \?\? meta/);
  assert.match(panel, /openPicker\(playbackMeta, ep/);
  assert.match(panel, /savePlayback\(\s*playbackMeta\.id/);
  assert.match(panel, /entryBrowser\.entries\.length > 1/);
  assert.match(panel, /isNextAired\(false, ep\.airDate\)/);
  assert.match(panel, /seasons\.includes\(0\)/);
  const watched = read("src/views/player/hooks/use-player-watched.ts");
  assert.match(watched, /entryId: string = meta\.id/);
  assert.match(watched, /allowAlias && !sameEntry/);
  const browser = read("src/components/player/episode-panel/use-anime-entries.ts");
  assert.match(browser, /previousAnimeEntry\(cursor\)/);
  assert.match(browser, /nextAnimeEntry\(cursor\)/);
});

test("player navigation switches to the next entry's meta", () => {
  const source = readFileSync(
    new URL("../src/views/player/hooks/use-episode-navigation.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /nextMeta\?\.id === ep\.sourceMetaId/);
  assert.match(source, /openPicker\(targetMeta, carried/);
});
