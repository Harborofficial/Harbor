import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { memoryMediaCache } from "./helpers/media-cache.mjs";
import * as episodeBuild from "../src/lib/providers/anime-episode-build.ts";
import * as identityCore from "../src/lib/streams/anime-identity-core.ts";

function load(file, mocks, globals = {}) {
  const output = ts.transpileModule(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  new Function("require", "exports", ...Object.keys(globals), output)(
    (name) => {
      assert.ok(name in mocks, `Unexpected dependency: ${name}`);
      return mocks[name];
    },
    exports,
    ...Object.values(globals),
  );
  return exports;
}

const nativeRow = (id = "50990", site = "anilist/anime", externalId = "208025") => ({
  type: "mappings",
  attributes: { externalSite: site, externalId },
  relationships: { item: { data: { type: "anime", id } } },
});

function harness() {
  const calls = [];
  const media = memoryMediaCache();
  let reverse = { data: [nativeRow()] };
  let forward = { data: [nativeRow()] };
  let primary = null;
  let alternate = {
    mappings: { kitsu_id: null, anilist_id: 208025, mal_id: 63509, thetvdb_id: 474294 },
    episodes: Object.fromEntries(
      [1, 2, 3, 4].map((n) => [
        String(n),
        {
          episodeNumber: n,
          seasonNumber: 1,
          tvdbId: 11628245 + n,
          image: `tvdb-${n}.jpg`,
          airDate: "2026-10-01",
        },
      ]),
    ),
  };
  let arm = null;
  let addonDirect = null;
  let nativeMalThrows = false;
  let anilist = { id: 208025, idMal: 63509, type: "ANIME", bannerImage: "banner.jpg" };
  const kitsu = {
    parseKitsuId: (id) => (/^kitsu:(\d+)$/.test(id) ? Number(id.slice(6)) : null),
    kitsuMappingRequest: async (path, maxAge) => {
      calls.push(["native", path, maxAge]);
      if (nativeMalThrows && path.includes("externalSite=myanimelist")) {
        throw new Error("Kitsu unavailable");
      }
      return (
        await media.loadMedia(
          "mapping-test",
          [path],
          async () => {
            if (path.startsWith("/anime/")) return forward;
            const query = new URLSearchParams(path.split("?")[1]);
            assert.equal(
              query.get("include"),
              "item",
              "Kitsu omits relationship IDs unless item is included",
            );
            const site = query.get("filter[externalSite]");
            return site === "myanimelist/anime" ? { data: [] } : reverse;
          },
          { ttl: 1_800_000, maxAge },
        )
      ).value;
    },
    kitsuAnime: async () => ({
      id: 50990,
      title: "I'm Dating a Dark Summoner",
      altTitles: ["Dark Summoner to Dekiteiru"],
      synopsis: "A real synopsis",
      year: "2026",
      subtype: "TV",
      genres: [],
    }),
    kitsuEpisodes: async () => [],
    kitsuStreamingLinks: async () => [],
    kitsuCharacters: async () => [],
    kitsuRelated: async () => [],
    kitsuStudios: async () => [],
  };
  const native = load("src/lib/providers/kitsu-mapping.ts", { "./kitsu": kitsu });
  const anilistEntry = load("src/lib/anilist/entry.ts", {
    "@/lib/media-cache": media,
    "./client": {
      anilistRequest: async () => {
        calls.push(["anilist"]);
        return { Media: anilist };
      },
    },
  });
  const az = {
    aniZipByKitsu: async () => primary,
    aniZipByAnilist: async () => {
      calls.push(["alternate"]);
      return alternate;
    },
    aniZipByMal: async () => alternate,
  };
  const mapping = load(
    "src/lib/providers/anime-mapping.ts",
    {
      "@/lib/providers/anizip": az,
      "@/lib/providers/kitsu": kitsu,
      "./kitsu-mapping": native,
      "@/lib/streams/anime-identity-core": {},
      "@/lib/anime-identity-db": {},
      "./mapping-store": {
        mappingStore: () => {
          const map = new Map();
          return {
            ready: Promise.resolve(),
            get: (key) => map.get(key),
            set: (key, value) => map.set(key, value),
          };
        },
      },
    },
    {
      localStorage: { getItem: () => null },
      fetch: async () => {
        calls.push(["arm"]);
        return { ok: true, json: async () => ({ kitsu: arm }) };
      },
    },
  );
  const videos = Array.from({ length: 12 }, (_, i) => ({
    id: `kitsu:50990:${i + 1}`,
    episode: i + 1,
    season: 1,
    title: `Episode ${i + 1}`,
    thumbnail: `broken-addon-${i + 1}.jpg`,
  }));
  const addon = {
    animeKitsuMeta: async (id, maxAge) => {
      calls.push(["addon", id, maxAge]);
      return id === "kitsu:50990" ? { id, videos } : addonDirect;
    },
  };
  const entry = load("src/lib/providers/anime-entry.ts", {
    "@/lib/providers/anime-kitsu-addon": addon,
    "@/lib/providers/anime-mapping": mapping,
    "@/lib/providers/kitsu": kitsu,
    "./kitsu-mapping": native,
    "@/lib/anilist/entry": anilistEntry,
  });
  return {
    calls,
    media,
    native,
    mapping,
    entry,
    addon,
    kitsu,
    az,
    videos,
    reverse: (value) => {
      reverse = value;
    },
    forward: (value) => {
      forward = value;
    },
    primary: (value) => {
      primary = value;
    },
    getPrimary: () => primary,
    alternate: (value) => {
      alternate = value;
    },
    getAlternate: () => alternate,
    arm: (value) => {
      arm = value;
    },
    direct: (value) => {
      addonDirect = value;
    },
    anilist: (value) => {
      anilist = value;
    },
    nativeMalThrows: (value) => {
      nativeMalThrows = value;
    },
  };
}

test("MAL and AniList recover through native mappings, retaining addon-first precedence", async () => {
  const h = harness();
  assert.equal((await h.entry.resolveAnimeEntry("mal:63509")).kitsuId, 50990);
  assert.equal((await h.entry.resolveAnimeEntry("anilist:208025")).kitsuId, 50990);
  assert.equal(h.calls.filter(([kind]) => kind === "anilist").length, 1);
  const direct = harness();
  direct.direct({ id: "kitsu:12", videos: [] });
  assert.equal((await direct.entry.resolveAnimeEntry("mal:63509")).kitsuId, 12);
  assert.deepEqual(
    direct.calls.map(([kind]) => kind),
    ["addon"],
  );
  const arm = harness();
  arm.arm(12);
  assert.equal((await arm.entry.resolveAnimeEntry("mal:63509")).kitsuId, 12);
  assert.deepEqual(
    arm.calls.map(([kind]) => kind),
    ["addon", "arm"],
  );
});

for (const [name, document] of Object.entries({
  ambiguous: { data: [nativeRow(), nativeRow("50991")] },
  manga: {
    data: [{ ...nativeRow(), relationships: { item: { data: { type: "manga", id: "50990" } } } }],
  },
  wrongExternalId: { data: [nativeRow("50990", "anilist/anime", "99")] },
  nextPage: { data: [nativeRow()], links: { next: "https://example.invalid/next" } },
  missingPage: { data: [nativeRow()], meta: { count: 2 } },
  malformed: { data: [null] },
}))
  test(`native recovery rejects ${name}`, async () => {
    const h = harness();
    h.reverse(document);
    assert.equal(await h.entry.resolveAnimeEntry("anilist:208025"), null);
  });

test("an explicit retry bypasses cached absence without clearing unrelated metadata", async () => {
  const h = harness();
  h.reverse({ data: [] });
  assert.equal(await h.entry.resolveAnimeEntry("mal:63509"), null);
  h.reverse({ data: [nativeRow()] });
  assert.equal(await h.entry.resolveAnimeEntry("mal:63509"), null);
  assert.equal((await h.entry.resolveAnimeEntry("mal:63509", 0)).kitsuId, 50990);
  assert.ok(h.calls.some(([kind, , maxAge]) => kind === "native" && maxAge === 0));
});

test("the exact MAL bridge rejects a mismatched AniList record", async () => {
  const h = harness();
  h.anilist({ id: 208025, idMal: 9, type: "ANIME" });
  assert.equal(await h.entry.resolveAnimeEntry("mal:63509"), null);
});

test("the MAL bridge survives a native Kitsu failure", async () => {
  const h = harness();
  h.nativeMalThrows(true);
  assert.equal((await h.entry.resolveAnimeEntry("mal:63509"))?.kitsuId, 50990);
});

test("Kitsu native forward IDs recover enrichment and reject conflicting Kitsu identities", async () => {
  const h = harness();
  assert.equal(await h.mapping.kitsuToAnilist(50990), 208025);
  assert.equal((await h.mapping.animeMappingByKitsu(50990)).mappings.thetvdb_id, 474294);
  h.alternate({ mappings: { kitsu_id: 12, anilist_id: 208025 }, episodes: {} });
  assert.equal(await h.mapping.animeMappingByKitsu(50990), null);
  h.primary({ mappings: { kitsu_id: 50990, thetvdb_id: 1 }, episodes: {} });
  const before = h.calls.filter(([kind]) => kind === "alternate").length;
  assert.equal((await h.mapping.animeMappingByKitsu(50990)).mappings.thetvdb_id, 1);
  assert.equal(h.calls.filter(([kind]) => kind === "alternate").length, before);
});

test("a conflicting primary never supplies cross IDs and native recovery still wins", async () => {
  const h = harness();
  h.primary({
    mappings: {
      kitsu_id: 12,
      thetvdb_id: 999,
      mal_id: 1,
      anilist_id: 999,
      imdb_id: "tt999",
    },
    episodes: { 1: { seasonNumber: 1, episodeNumber: 1, tvdbId: 999 } },
  });
  assert.equal((await h.mapping.animeMappingByKitsu(50990)).mappings.thetvdb_id, 474294);
  assert.equal(await h.mapping.kitsuToTvdb(50990), 474294);
  assert.equal(await h.mapping.kitsuToMal(50990), 63509);
  assert.equal(await h.mapping.kitsuToAnilist(50990), 208025);
  assert.notEqual(await h.mapping.kitsuToImdb(50990), "tt999");
});

test("a primary with episodes but no cross IDs is merged with the native mapping", async () => {
  const h = harness();
  h.primary({
    mappings: { kitsu_id: 50990 },
    episodes: {
      1: { seasonNumber: 1, episodeNumber: 1, tvdbId: 1 },
      2: { seasonNumber: 1, episodeNumber: 2, tvdbId: 2 },
    },
  });
  const mapping = await h.mapping.animeMappingByKitsu(50990, ["thetvdb_id"]);
  assert.equal(mapping.mappings.thetvdb_id, 474294);
  assert.deepEqual(mapping.episodes, h.getPrimary().episodes);
  assert.equal(await h.mapping.kitsuToTvdb(50990), 474294);
});

test("the recovered AniDB id reaches the season-window resolver", async () => {
  const h = harness();
  h.alternate({
    ...h.getAlternate(),
    mappings: { ...h.getAlternate().mappings, anidb_id: 19908 },
  });
  assert.equal(await h.mapping.kitsuToAnidb(50990), 19908);
});

test("TMDB and IMDb base resolvers reach the native AniList mapping", async () => {
  const h = harness();
  h.az.aniZipByTmdbTv = async () => ({
    mappings: { anilist_id: 208025, themoviedb_id: 335790, kitsu_id: null },
  });
  h.az.aniZipByImdb = async () => ({
    mappings: { anilist_id: 208025, imdb_id: "tt43650323", kitsu_id: null },
  });
  assert.equal(await h.mapping.tmdbTvToKitsu(335790), 50990);
  assert.equal(await h.mapping.imdbToKitsu("tt43650323"), 50990);
});

test("the external-id helper is reusable outside the detail loader", async () => {
  const h = harness();
  assert.equal(await h.entry.resolveExternalKitsuId("mal:63509"), 50990);
  assert.equal(await h.entry.resolveExternalKitsuId("anilist:208025"), 50990);
  assert.equal(await h.entry.resolveExternalKitsuId("mal:not-a-number"), null);
});

test("the tracker resolver reuses the native external mapping", async () => {
  const h = harness();
  h.primary({
    mappings: { kitsu_id: 50990, thetvdb_id: 474294 },
    episodes: { 1: { seasonNumber: 1, episodeNumber: 1, absoluteEpisodeNumber: 1 } },
  });
  const tracker = load("src/lib/anime-tracker-entry.ts", {
    "@/lib/providers/anizip": h.az,
    "@/lib/providers/anime-mapping": h.mapping,
    "@/lib/providers/anime-entry": h.entry,
    "@/lib/providers/kitsu": h.kitsu,
    "@/lib/streams/anime-identity-core": identityCore,
  });
  const entry = await tracker.resolveTrackerAnimeEntry("mal:63509", {
    season: 1,
    episode: 1,
  });
  assert.equal(entry?.id, "kitsu:50990");
});

test("stream identity resolution reuses the native external mapping", async () => {
  const h = harness();
  h.primary({
    mappings: { kitsu_id: 50990, thetvdb_id: 474294 },
    episodes: { 1: { seasonNumber: 1, episodeNumber: 1, absoluteEpisodeNumber: 1 } },
  });
  const identity = load("src/lib/streams/anime-identity.ts", {
    "@/lib/providers/anizip": h.az,
    "@/lib/providers/anime-mapping": h.mapping,
    "@/lib/providers/anime-entry": h.entry,
    "@/lib/providers/anime-franchise-root": { franchiseRoot: async (id) => id },
    "@/lib/providers/kitsu": { ...h.kitsu, kitsuSearchAnime: async () => [] },
    "./stream-ids": { buildStreamIds: () => [] },
    "./anime-identity-core": identityCore,
    "@/lib/debug": { dlog: () => {} },
  });
  const resolved = await identity.resolveAnimeIdentity("mal:63509", null, {
    season: 1,
    episode: 1,
  });
  assert.equal(resolved?.streamId, "kitsu:50990:1");
});

test("tracker and stream identity recover an AniZip entry that only exists by AniList id", async () => {
  const h = harness();
  const tracker = load("src/lib/anime-tracker-entry.ts", {
    "@/lib/providers/anizip": h.az,
    "@/lib/providers/anime-mapping": h.mapping,
    "@/lib/providers/anime-entry": h.entry,
    "@/lib/providers/kitsu": h.kitsu,
    "@/lib/streams/anime-identity-core": identityCore,
  });
  assert.deepEqual(await tracker.resolveTrackerAnimeEntry("mal:63509", { season: 1, episode: 1 }), {
    id: "kitsu:50990",
    episode: 1,
    baseId: "kitsu:50990",
  });

  const identity = load("src/lib/streams/anime-identity.ts", {
    "@/lib/providers/anizip": h.az,
    "@/lib/providers/anime-mapping": h.mapping,
    "@/lib/providers/anime-entry": h.entry,
    "@/lib/providers/anime-franchise-root": { franchiseRoot: async (id) => id },
    "@/lib/providers/kitsu": { ...h.kitsu, kitsuSearchAnime: async () => [] },
    "./stream-ids": { buildStreamIds: () => [] },
    "./anime-identity-core": identityCore,
    "@/lib/debug": { dlog: () => {} },
  });
  const resolved = await identity.resolveAnimeIdentity("mal:63509", null, {
    season: 1,
    episode: 1,
  });
  assert.equal(resolved?.streamId, "kitsu:50990:1");
});

test("the real detail loader recovers synopsis, native playback IDs and distinct aired artwork", async () => {
  for (const id of ["mal:63509", "anilist:208025"]) {
    const h = harness();
    const optional = new Proxy({}, { get: () => async () => null });
    const detail = load(
      "src/lib/providers/anime-detail.ts",
      new Proxy(
        {
          "@/lib/media-cache": h.media,
          "@/lib/providers/kitsu": h.kitsu,
          "@/lib/providers/anime-kitsu-addon": h.addon,
          "@/lib/providers/anime-entry": h.entry,
          "@/lib/providers/anime-mapping": { ...h.mapping, applyAnidbSeasonWindow: async () => {} },
          "@/lib/providers/anime-episode-build": episodeBuild,
          "@/lib/providers/anime-episode-enrich": { enrichEpisodes: async () => {} },
          "./anime-recommendations": { animeRecommendations: async () => [] },
          "@/lib/anilist/relations": { anilistFranchise: async () => [] },
          "@/lib/anilist/browse": { anilistArtById: async () => ({ banner: "banner.jpg" }) },
          "@/lib/providers/tvdb": { tvdbLangFromIso1: () => "eng" },
        },
        { has: () => true, get: (target, key) => target[key] ?? optional },
      ),
    );
    let early;
    const result = await detail.animeDetails(
      { tmdbLanguage: "en", uiLanguage: "en" },
      { id, type: "series", name: "I'm Dating a Dark Summoner" },
      (episodes) => {
        early = episodes;
      },
    );
    assert.equal(result.detail.overview, "A real synopsis");
    assert.equal(early[0].streamId, "kitsu:50990:1");
    assert.equal(result.episodes.length, 12);
    assert.deepEqual(
      result.episodes.slice(0, 4).map((ep) => ep.thumbnail),
      ["tvdb-1.jpg", "tvdb-2.jpg", "tvdb-3.jpg", "tvdb-4.jpg"],
    );
    assert.equal(result.episodes[0].thumbnailFallback, "broken-addon-1.jpg");
    assert.equal(await result.heroBgPromise, "banner.jpg");
    await result.extrasPromise;
    await result.enrichPromise;
  }
});

test("the shared episode reader retains native playback IDs after recovering a MAL entry", async () => {
  const h = harness();
  const optional = new Proxy({}, { get: () => async () => null });
  const series = load(
    "src/lib/series-episodes.ts",
    new Proxy(
      {
        "@/lib/media-cache": h.media,
        "./providers/anime-entry": h.entry,
        "./providers/anime-kitsu-addon": h.addon,
        "./providers/anime-mapping": h.mapping,
        "./providers/kitsu": h.kitsu,
        "./providers/anizip": h.az,
        "./providers/anime-franchise-root": { franchiseRoot: async (id) => id },
        "./providers/tvdb-proxy": {
          fetchTvdbProxyImages: async () => ({}),
          pickTvdbImage: () => null,
        },
      },
      { has: () => true, get: (target, key) => target[key] ?? optional },
    ),
  );
  const episodes = await series.fetchSeasonEpisodes(
    { id: "mal:63509", type: "series", name: "I'm Dating a Dark Summoner" },
    1,
    { tmdbKey: "" },
  );
  assert.equal(episodes.length, 12);
  assert.equal(episodes[0].kitsuStreamId, "kitsu:50990:1");
  assert.equal(episodes[0].imdbId, undefined, "an entry link must not invent an IMDb identity");

  h.alternate({
    mappings: { kitsu_id: 12, anilist_id: 208025, thetvdb_id: 99 },
    episodes: { 1: { episodeNumber: 1, seasonNumber: 9, tvdbId: 999, image: "wrong.jpg" } },
  });
  const conflicted = await series.fetchSeasonEpisodes(
    { id: "anilist:208025", type: "series", name: "I'm Dating a Dark Summoner" },
    1,
    { tmdbKey: "" },
  );
  assert.equal(conflicted[0].kitsuStreamId, "kitsu:50990:1");
  assert.equal(
    conflicted[0].imdbSeason,
    undefined,
    "secondary lookup cannot bypass Kitsu conflict rejection",
  );
  assert.notEqual(conflicted[0].still, "wrong.jpg");
});

test("search recovery requires matching external ID, entry title and year", async () => {
  const h = harness();
  let source = { mappings: { themoviedb_id: "335790", anilist_id: 208025 } };
  const recovery = load("src/views/detail/resolve-anime-entry.ts", {
    "@/lib/providers/anizip": { aniZipByTmdbTv: async () => source },
    "@/lib/providers/anime-entry": h.entry,
    "@/lib/providers/kitsu": h.kitsu,
  });
  const meta = { id: "tmdb:tv:335790", name: "I'm Dating a Dark Summoner", releaseInfo: "2026" };
  assert.equal(await recovery.recoverDetailAnimeEntry(meta, null), 50990);
  assert.equal(
    await recovery.recoverDetailAnimeEntry({ ...meta, releaseInfo: "2025" }, null),
    null,
  );
  assert.equal(
    await recovery.recoverDetailAnimeEntry({ ...meta, name: "Another season" }, null),
    null,
  );
  source = { mappings: { themoviedb_id: "99", anilist_id: 208025 } };
  assert.equal(await recovery.recoverDetailAnimeEntry(meta, null), null);
});

test("short anime load proxy artwork once and reject an older title's late response", async () => {
  let state = null;
  let dependencies;
  let pending;
  let cleanup;
  const requests = [];
  const react = {
    useState: () => [
      state,
      (next) => {
        state = next;
      },
    ],
    useEffect: (run, deps) => {
      if (!dependencies || deps.some((value, index) => value !== dependencies[index])) {
        dependencies = deps;
        pending = run;
      }
    },
  };
  const hook = load("src/views/detail/anime-episodes/use-tvdb-proxy-images.ts", {
    react,
    "@/lib/providers/tvdb-proxy": {
      fetchTvdbProxyImages: (args) =>
        new Promise((resolve) => {
          requests.push({ args, resolve });
        }),
    },
  });
  const render = (id) => {
    const result = hook.useTvdbProxyImages(id, null, 12, "aired");
    if (pending) {
      cleanup?.();
      cleanup = pending();
      pending = null;
    }
    return result;
  };
  assert.deepEqual(render(50990), {});
  requests[0].resolve({ s1e1: "first-title.jpg" });
  await Promise.resolve();
  assert.deepEqual(render(50990), { s1e1: "first-title.jpg" });
  assert.equal(requests.length, 1, "rendering a 12-episode series must not repeat its request");
  assert.deepEqual(render(51000), {}, "a new title must not render the old image map");
  assert.deepEqual(render(51001), {});
  requests[1].resolve({ s1e1: "late-old-title.jpg" });
  await Promise.resolve();
  assert.deepEqual(render(51001), {});
  requests[2].resolve({ s1e1: "current-title.jpg" });
  await Promise.resolve();
  assert.deepEqual(render(51001), { s1e1: "current-title.jpg" });
  cleanup?.();
});

test("the recovered artwork and retry guards stay wired at their call sites", () => {
  const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  assert.match(
    read("src/lib/series-episodes.ts"),
    /absoluteNumber: ep\.absoluteNumber/,
    "the season reader must pass the real absolute number to the image picker",
  );
  assert.match(
    read("src/views/big-picture/use-bp-anime-detail.ts"),
    /if \(ep\.airdate && isUpcomingDate\(ep\.airdate\)\) return ep;/,
    "Big Picture must not borrow proxy art for a future episode",
  );
  const detail = read("src/views/detail.tsx");
  assert.match(detail, /meta\.type !== "movie" &&/);
  assert.match(detail, /failedKitsu\.current = null;/);
  assert.doesNotMatch(
    detail,
    /!liveContext &&\s*isAnime &&\s*!loading &&\s*animeUnavailable/,
    "the retry state must survive a detected-anime fallback",
  );
});
