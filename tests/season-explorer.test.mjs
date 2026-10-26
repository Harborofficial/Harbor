import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { memoryMediaCache } from "./helpers/media-cache.mjs";
import * as episodeTextLanguage from "../src/lib/episode-text-language.ts";
import * as tmdbTitleFallback from "../src/lib/providers/tmdb/tmdb-title-fallback.ts";
import * as React from "react";
import { JSDOM } from "jsdom";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";

function load(file, dependencies, globals = {}) {
  const frames = new Map();
  let frameId = 0;
  const requestFrame = (callback) => {
    const id = ++frameId;
    frames.set(id, callback);
    queueMicrotask(() => {
      if (!frames.has(id)) return;
      frames.delete(id);
      callback(0);
    });
    return id;
  };
  const source = readFileSync(new URL("../" + file, import.meta.url), "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    setTimeout,
    clearTimeout,
    queueMicrotask,
    AbortController,
    requestAnimationFrame: requestFrame,
    cancelAnimationFrame: (id) => frames.delete(id),
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    ...globals,
    require: (name) => {
      assert.ok(name in dependencies, "unmocked dependency " + name);
      return dependencies[name];
    },
  });
  return module.exports;
}

function providerFixture({
  fail = false,
  localizedOverview = " ",
  missingEnglish = false,
  requestedLanguage = "fra",
  proxyOverview,
  proxyLanguages = ["eng"],
  englishOverview = "English season synopsis",
  seriesArtwork = [],
  catalogImage,
} = {}) {
  const calls = [];
  const requests = [];
  const tvdb = load("src/lib/providers/tvdb.ts", {
    "@/lib/media-cache": memoryMediaCache(),
    "@/lib/episode-text-language": episodeTextLanguage,
    "@/lib/cache": { lruSet: (map, key, value) => map.set(key, value) },
    "@/lib/memory-profiler": { registerCache: () => {} },
    "@/lib/config/endpoints": { HARBOR_TVDB_BASE: "https://mock.invalid" },
    "@/lib/safe-fetch": {
      safeFetch: async (url, options) => {
        requests.push({ url, options });
        const path = new URL(url).pathname;
        calls.push(path);
        if (path.endsWith("/login"))
          return { ok: true, json: async () => ({ data: { token: "test-token" } }) };
        if (fail) return { ok: false, status: 404 };
        if (path.includes("/series/"))
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: {
                artworks: seriesArtwork,
                seasons: [
                  {
                    ...season,
                    image: catalogImage ?? season.image,
                    name: "Saga française",
                    type: { type: "official" },
                    overview:
                      new URL(url).searchParams.get("overviewLang") === "eng"
                        ? englishOverview
                        : (proxyOverview ?? season.overview),
                    overviewTranslations: proxyLanguages,
                  },
                ],
              },
            }),
          };
        if (missingEnglish && path.endsWith("/eng")) return { ok: false, status: 404 };
        const data = path.endsWith(`/${requestedLanguage}`)
          ? { name: "Saga française", overview: localizedOverview }
          : path.endsWith("/eng")
            ? { name: "English Saga", overview: englishOverview }
            : {
                image: "/default.jpg",
                artwork: [
                  { type: 7, language: "eng", score: 99, image: "/english.jpg" },
                  { type: 7, language: "fra", score: 2, image: "/french.jpg" },
                  {
                    type: 6,
                    width: 758,
                    height: 140,
                    language: "fra",
                    score: 100,
                    image: "/banner.jpg",
                  },
                  { width: 1920, height: 1080, score: 10, image: "/background.jpg" },
                ],
              };
        return { ok: true, status: 200, json: async () => ({ data }) };
      },
    },
  });
  const details = load("src/lib/providers/tvdb-season-details.ts", {
    "./tvdb": tvdb,
    "@/lib/episode-text-language": episodeTextLanguage,
  });
  return { ...tvdb, ...details, calls, requests };
}

async function fetchCompleteSeason(f, key, info, lang) {
  const [text, artwork] = await Promise.all([
    f.fetchTvdbSeasonDetails(key, info, lang),
    f.fetchTvdbSeasonArtwork(key, info, lang),
  ]);
  return { ...text, ...artwork };
}

const season = {
  id: 31893,
  number: 1,
  name: "East Blue",
  overview: "East Blue synopsis",
  overviewLanguage: "en",
  image: "https://artworks.thetvdb.com/base.jpg",
};

test("selected season uses its own TVDB ID, localized poster, and per-field English fallback", async () => {
  const f = providerFixture();
  const result = await fetchCompleteSeason(f, "test-key", season, "fra");
  assert.equal(result.name, "English Saga");
  assert.equal(result.overview, "English season synopsis");
  assert.equal(result.poster, "https://artworks.thetvdb.com/french.jpg");
  assert.equal(result.background, "https://artworks.thetvdb.com/background.jpg");
  assert.deepEqual(f.calls.filter((path) => path.includes("/seasons/")).sort(), [
    "/v4/seasons/31893/extended",
    "/v4/seasons/31893/translations/eng",
    "/v4/seasons/31893/translations/fra",
  ]);
});

test("revisiting a season reuses cached requests and English requires just one translation", async () => {
  const f = providerFixture();
  await fetchCompleteSeason(f, "test-key", season, "eng");
  const callCount = f.calls.length;
  await fetchCompleteSeason(f, "test-key", season, "eng");
  assert.equal(f.calls.length, callCount);
  assert.equal(f.calls.filter((path) => path.includes("/translations/")).length, 1);
});

test("proxy users use the season data already embedded in series extended", async () => {
  const f = providerFixture();
  const result = await fetchCompleteSeason(f, "", season, "fra");
  assert.equal(result.name, "East Blue");
  assert.equal(result.overview, "East Blue synopsis");
  assert.equal(result.poster, season.image);
  assert.equal(f.requests.length, 0);
});

test("unavailable proxy metadata still uses the base season", async () => {
  const f = providerFixture({ fail: true });
  const result = await fetchCompleteSeason(f, "", season, "eng");
  assert.equal(result.name, "East Blue");
  assert.equal(result.poster, season.image);
  assert.equal(result.overview, "East Blue synopsis");
});

test("seasons without a TVDB ID preserve base data without requests", async () => {
  const f = providerFixture();
  const result = await fetchCompleteSeason(f, "", { ...season, id: null }, "eng");
  assert.equal(result.name, "East Blue");
  assert.equal(result.poster, season.image);
  assert.equal(f.calls.length, 0);
});

test("missing season metadata degrades to the base poster", async () => {
  const f = providerFixture({ fail: true });
  const result = await fetchCompleteSeason(f, "test-key", season, "eng");
  assert.equal(result.poster, season.image);
  assert.equal(result.overview, undefined);
});

test("proxy season catalogs request localized overviews and keep them", async () => {
  const f = providerFixture();
  const seasons = await f.tvdbSeasons("", 81797, "official", "fra");
  assert.equal(seasons.get(1).name, "Saga française");
  assert.equal(seasons.get(1).overview, "East Blue synopsis");
  assert.ok(f.requests.some((request) => request.url.includes("overviewLang=fra")));
});

test("season artwork rejects banners and chooses English then textless posters", () => {
  const { pickSeasonPoster } = providerFixture();
  const artwork = [
    { type: 6, image: "/banner.jpg", language: "tur", score: 100 },
    { type: 7, image: "/japanese.jpg", language: "jpn", score: 99 },
    { type: 7, image: "/neutral.jpg", language: "", includesText: false, score: 10 },
  ];
  assert.equal(
    pickSeasonPoster({ artwork, lang: "tur" }),
    "https://artworks.thetvdb.com/neutral.jpg",
  );
  artwork.push({ type: 7, image: "/english.jpg", language: "eng", score: 1 });
  assert.equal(
    pickSeasonPoster({ artwork, lang: "tur" }),
    "https://artworks.thetvdb.com/english.jpg",
  );
});

test("a season poster outranks a higher-scored series poster", () => {
  const { pickSeasonPoster } = providerFixture();
  const artwork = [
    { type: 2, image: "/series.jpg", language: "eng", score: 99 },
    { type: 7, image: "/season.jpg", language: "eng", score: 2 },
  ];
  assert.equal(
    pickSeasonPoster({ artwork, lang: "eng" }),
    "https://artworks.thetvdb.com/season.jpg",
  );
  assert.equal(
    pickSeasonPoster({ artwork: [artwork[0]], lang: "eng" }),
    "https://artworks.thetvdb.com/series.jpg",
  );
});

test("proxy artwork prefers a real poster for the exact season over the catalog background", async () => {
  const f = providerFixture({
    seriesArtwork: [
      { type: 7, seasonId: 2002723, language: "eng", score: 99, image: "/wrong-season.jpg" },
      { type: 2, language: "eng", score: 999, image: "/series.jpg" },
      { type: 7, seasonId: 2002722, language: "jpn", score: 100, image: "/japanese.jpg" },
      {
        type: 7,
        seasonId: 2002722,
        language: "eng",
        image: "/season-3.jpg",
        width: 680,
        height: 1000,
      },
      { type: 7, seasonId: 646689, language: "eng", image: "/specials.jpg" },
    ],
  });
  const info = {
    ...season,
    id: 2002722,
    number: 3,
    seriesId: 303867,
    image: "https://artworks.thetvdb.com/banners/v4/season/2002722/backgrounds/promo.jpg",
  };
  const [regular, specials] = await Promise.all([
    f.fetchTvdbSeasonArtwork("", info, "tur"),
    f.fetchTvdbSeasonArtwork("", { ...info, id: 646689, number: 0 }, "eng"),
  ]);
  assert.equal(regular.poster, "https://artworks.thetvdb.com/season-3.jpg");
  assert.equal(specials.poster, "https://artworks.thetvdb.com/specials.jpg");
  assert.equal(f.requests.length, 1, "visible seasons share the cached series artwork request");
  assert.ok(f.requests[0].url.endsWith("/series/303867/extended"));
  assert.ok(!f.requests[0].options.headers.authorization);
});

test("landscape images never stand in for posters in the catalog or artwork fallback", async () => {
  const background = "https://artworks.thetvdb.com/banners/v4/season/2002722/backgrounds/promo.jpg";
  const f = providerFixture({ catalogImage: background });
  const catalog = await f.tvdbSeasons("", 303867, "official", "eng");
  assert.equal(catalog.get(1).image, undefined);
  assert.equal(f.pickSeasonPoster({ extendedImage: background, baseImage: background }), undefined);
  assert.equal(
    f.pickSeasonPoster({ artwork: [{ type: 7, image: "/wide.jpg", width: 1920, height: 1080 }] }),
    undefined,
  );
  let fallbackCalls = 0;
  const updates = [];
  const loader = f.createSeasonArtworkLoader(
    "",
    "eng",
    (number, art) => updates.push({ number, art }),
    {
      titlePoster: "/title.jpg",
      loadFallback: async () => {
        fallbackCalls++;
        return "https://image.tmdb.org/t/p/w500/season-3.jpg";
      },
    },
  );
  loader.request([{ ...season, id: 2002722, seriesId: 303867, number: 3, image: background }], 3);
  await flush();
  assert.equal(updates.at(-1).art.poster, "https://image.tmdb.org/t/p/w500/season-3.jpg");
  assert.equal(fallbackCalls, 1);
  loader.dispose();
});

test("an available proxy TVDB season poster prevents the TMDB fallback", async () => {
  const f = providerFixture({
    seriesArtwork: [{ type: 7, seasonId: 2002722, language: "eng", image: "/season-3.jpg" }],
  });
  let fallbackCalls = 0;
  const updates = [];
  const loader = f.createSeasonArtworkLoader("", "eng", (_number, art) => updates.push(art), {
    loadFallback: async () => {
      fallbackCalls++;
      return "/tmdb.jpg";
    },
  });
  loader.request([{ ...season, id: 2002722, seriesId: 303867, number: 3 }], 3);
  await flush();
  assert.equal(updates.at(-1).poster, "https://artworks.thetvdb.com/season-3.jpg");
  assert.equal(fallbackCalls, 0);
  loader.dispose();
});

function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const flush = async () => {
  await new Promise((resolve) => setImmediate(resolve));
};

function tmdbArtworkFixture(get = async () => null) {
  const calls = [];
  const images = load("src/lib/providers/tmdb/tmdb-image-rungs.ts", {
    "./tmdb-client": { IMG: "https://image.tmdb.org/t/p" },
  });
  const provider = load("src/lib/providers/tmdb-season-artwork.ts", {
    "@/lib/cache": {
      lruSet: (map, key, value, max) => {
        map.set(key, value);
        while (map.size > max) map.delete(map.keys().next().value);
      },
    },
    "@/lib/memory-profiler": { registerCache: () => {} },
    "@/lib/episode-text-language": episodeTextLanguage,
    "./tmdb/tmdb-image-rungs": images,
    "./tmdb/tmdb-client": {
      get: async (key, path, params) => {
        calls.push({ key, path, params });
        return get(key, path, params);
      },
    },
  });
  return { ...provider, calls };
}

function synopsisFixture(get = async () => null, globals = {}) {
  const calls = [];
  const provider = load(
    "src/lib/providers/season-synopsis.ts",
    {
      "@/lib/cache": {
        lruSet: (map, key, value, max) => {
          map.set(key, value);
          while (map.size > max) map.delete(map.keys().next().value);
        },
      },
      "@/lib/memory-profiler": { registerCache: () => {} },
      "@/lib/episode-text-language": episodeTextLanguage,
      "./tmdb/tmdb-client": {
        get: async (key, path, params) => {
          calls.push({ key, path, params });
          return get(key, path, params);
        },
      },
    },
    globals,
  );
  return { ...provider, calls };
}

function seasonTranslations(...entries) {
  return {
    translations: entries.map(([language, overview, region]) => ({
      iso_639_1: language,
      iso_3166_1: region,
      data: { overview },
    })),
  };
}

const tvdbLanguage = (lang) =>
  ({ en: "eng", fr: "fra", tr: "tur", ar: "ara" })[episodeTextLanguage.episodeLanguageBase(lang)] ??
  "eng";

function hookFixture({
  catalog,
  detail,
  artwork,
  tmdbGet,
  synopsisGet,
  react: suppliedReact,
} = {}) {
  const state = [],
    effects = [],
    cleanups = [],
    dependencies = [];
  const calls = [];
  const artworkCalls = [];
  const tmdbArtwork = tmdbArtworkFixture(tmdbGet);
  const synopsis = synopsisFixture(synopsisGet);
  let stateIndex = 0,
    effectIndex = 0;
  const react = suppliedReact ?? {
    useMemo: (callback, deps) => {
      const memo = react.useRef();
      if (!memo.current || !deps?.every((value, i) => Object.is(value, memo.current.deps?.[i])))
        memo.current = { deps, value: callback() };
      return memo.current.value;
    },
    useCallback: (callback) => callback,
    useRef: (initial) => react.useState({ current: initial })[0],
    useState: (initial) => {
      const index = stateIndex++;
      if (!(index in state)) state[index] = initial;
      return [
        state[index],
        (value) => {
          state[index] = typeof value === "function" ? value(state[index]) : value;
        },
      ];
    },
    useEffect: (effect, deps) => {
      const index = effectIndex++;
      if (dependencies[index]?.every((value, i) => Object.is(value, deps[i]))) return;
      effects.push(() => {
        cleanups[index]?.();
        cleanups[index] = effect();
      });
      dependencies[index] = deps;
    },
  };
  const artworkProvider = load("src/lib/providers/tvdb-season-details.ts", {
    "@/lib/episode-text-language": episodeTextLanguage,
    "./tvdb": {
      tvdbLangFromIso1: tvdbLanguage,
      pickSeasonPoster: ({ extendedImage, baseImage }) => extendedImage ?? baseImage,
      tvdbSeasonExtended: async (_key, id) => {
        artworkCalls.push(id);
        return artwork ? artwork(id) : { image: `/preferred-${id}.jpg`, artwork: [] };
      },
    },
  });
  const hook = load("src/views/detail/use-season-explorer.ts", {
    react,
    "@/lib/providers/anime-mapping": { kitsuToTvdb: async (id) => id },
    "@/lib/providers/tmdb-season-artwork": tmdbArtwork,
    "@/lib/episode-text-language": episodeTextLanguage,
    "@/lib/providers/season-synopsis": synopsis,
    "@/lib/providers/kitsu": {
      parseKitsuId: (id) => Number(/^kitsu:(\d+)$/.exec(id)?.[1]) || null,
    },
    "@/lib/season-name": { isGenericSeasonName: (name, n) => name === `Season ${n}` },
    "@/lib/providers/tvdb": {
      tvdbLangFromIso1: tvdbLanguage,
      isDisplayableName: (value) => !/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/.test(value),
      tvdbSeasonNames: async () => new Map(),
      tvdbSeriesByRemote: async () => 81797,
      tvdbSeasons:
        catalog ??
        (async () =>
          new Map([
            [1, season],
            [2, { ...season, id: 31894, number: 2 }],
          ])),
    },
    "@/lib/providers/tvdb-season-details": {
      ...artworkProvider,
      fetchTvdbSeasonDetails: async (_key, info, lang) => {
        calls.push({ id: info.id, number: info.number, lang });
        const result = await (detail
          ? detail(info, lang)
          : { overview: `Season ${info.number} synopsis` });
        return result ? { overviewLanguage: "en", ...result } : result;
      },
    },
  });
  return {
    calls,
    artworkCalls,
    tmdbCalls: tmdbArtwork.calls,
    synopsisCalls: synopsis.calls,
    hook,
    englishSeasonItems: hook.englishSeasonItems,
    render: (props) => {
      stateIndex = 0;
      effectIndex = 0;
      const metadata = hook.useSeasonExplorer(props);
      const result = { ...metadata, ...hook.useSeasonExplorerArtwork(metadata) };
      effects.splice(0).forEach((effect) => effect());
      return result;
    },
    unmount: () => cleanups.forEach((cleanup) => cleanup?.()),
  };
}

const props = {
  metaId: "kitsu:81797",
  tvdbKey: "test-key",
  seasonType: "official",
  lang: "eng",
  activeSeason: 1,
};

test("changing seasons discards late synopses and only enriches selected seasons", async () => {
  const first = deferred();
  const f = hookFixture({
    detail: (info) => (info.number === 1 ? first.promise : { overview: "Second synopsis" }),
  });
  f.render(props);
  await flush();
  f.render(props);
  f.render({ ...props, activeSeason: 2 });
  await flush();
  first.resolve({ overview: "Late first synopsis" });
  await flush();
  const result = f.render({ ...props, activeSeason: 2 });
  assert.equal(result.details.get(2).overview, "Second synopsis");
  assert.equal(result.details.has(1), false);
  assert.equal(result.loading, false);
  assert.deepEqual(
    f.calls.map((call) => call.id),
    [31893, 31894],
  );
  f.unmount();
});

test("changing titles or languages immediately hides previous season details", async () => {
  const f = hookFixture();
  f.render(props);
  await flush();
  f.render(props);
  await flush();
  assert.equal(f.render(props).details.get(1).overview, "Season 1 synopsis");
  for (const changed of [
    { ...props, metaId: "kitsu:99" },
    { ...props, lang: "fra" },
  ]) {
    const result = f.render(changed);
    assert.equal(result.details.size, 0);
    assert.equal(result.seasons.size, 0);
  }
  f.unmount();
});

test("the explorer enriches the selected season without a personal key for anime", async () => {
  const f = hookFixture();
  const noKey = { ...props, tvdbKey: "", allowProxy: true };
  f.render(noKey);
  await flush();
  f.render(noKey);
  await flush();
  const result = f.render(noKey);
  assert.equal(result.details.get(1).overview, "Season 1 synopsis");
  assert.equal(result.loading, false);
  assert.equal(f.calls.length, 1);
  f.unmount();
});

test("a regular title without a TVDB key makes no season metadata requests", async () => {
  const f = hookFixture();
  const noKey = { ...props, tvdbKey: "" };
  f.render(noKey);
  await flush();
  const result = f.render(noKey);
  assert.equal(result.seasons.size, 0);
  assert.equal(result.details.size, 0);
  assert.equal(result.artwork.size, 0);
  assert.equal(f.calls.length, 0);
  assert.equal(f.artworkCalls.length, 0);
  f.unmount();
});

test("a TMDB key alone can fill season posters without a TVDB key", async () => {
  const f = hookFixture({
    tmdbGet: async (_key, path) => {
      if (path.startsWith("find/")) return { tv_results: [{ id: 99 }] };
      return {
        posters: [{ file_path: "/season1.jpg", iso_639_1: "en", vote_average: 4 }],
      };
    },
  });
  const tmdbOnly = {
    ...props,
    tvdbKey: "",
    tmdbKey: "tmdb-key",
    imdbId: "tt123",
    allowProxy: false,
  };
  f.render(tmdbOnly);
  await flush();
  f.render(tmdbOnly);
  await flush();
  const result = f.render(tmdbOnly);
  assert.equal(result.artwork.get(1).poster, "https://image.tmdb.org/t/p/w500/season1.jpg");
  assert.equal(f.artworkCalls.length, 0);
  assert.ok(f.tmdbCalls.some((call) => call.path === "find/tt123"));
  assert.ok(f.tmdbCalls.some((call) => call.path === "tv/99/season/1/images"));
  f.unmount();
});

test("extras do not inherit a numbered season synopsis", async () => {
  const f = hookFixture();
  const extras = { ...props, activeSeason: undefined };
  f.render(extras);
  await flush();
  f.render(extras);
  await flush();
  assert.equal(f.calls.length, 0);
  f.unmount();
});

test("preferred Turkish and Arabic TMDB synopses beat TVDB English through the explorer", async () => {
  for (const [lang, tvdbLang, code, synopsis] of [
    ["tr-TR", "tur", "tr", "Yeni sezonun Türkçe özeti"],
    ["ar-SA", "ara", "ar", "ملخص الموسم باللغة العربية"],
  ]) {
    const tvdb = providerFixture({ requestedLanguage: tvdbLang });
    const f = hookFixture({
      detail: (info, language) => tvdb.fetchTvdbSeasonDetails("test-key", info, language),
      synopsisGet: async () => seasonTranslations(["en", "TMDB English"], [code, synopsis]),
    });
    const options = { ...props, lang, tmdbKey: "tmdb-key", tmdbTvId: 42 };
    const data = await settleExplorer(f, options);
    assert.equal(data.details.get(1).overview, synopsis);
    assert.equal(data.details.get(1).overviewLanguage, code);
    assert.equal(data.details.get(1).name, "English Saga");
    assert.equal(f.synopsisCalls[0].path, "tv/42/season/1/translations");
    assert.equal(f.synopsisCalls[0].params.language, lang);
    assert.ok(tvdb.calls.some((path) => path.endsWith(`/translations/${tvdbLang}`)));
    f.unmount();
  }
});

test("preferred TVDB synopsis wins without requesting TMDB season text", async () => {
  const tvdb = providerFixture({ requestedLanguage: "tur", localizedOverview: "TVDB Türkçe özet" });
  const f = hookFixture({
    detail: (info, lang) => tvdb.fetchTvdbSeasonDetails("test-key", info, lang),
    synopsisGet: async () => seasonTranslations(["tr", "TMDB Türkçe özet"]),
  });
  const data = await settleExplorer(f, {
    ...props,
    lang: "tr-TR",
    tmdbKey: "tmdb-key",
    tmdbTvId: 42,
  });
  assert.equal(data.details.get(1).overview, "TVDB Türkçe özet");
  assert.equal(data.details.get(1).name, "English Saga");
  assert.equal(f.synopsisCalls.length, 0);
  f.unmount();
});

test("season synopsis fallback prefers TVDB English then TMDB English and rejects blanks", async () => {
  for (const [englishOverview, tmdbOverview, expected] of [
    ["TVDB English", "TMDB English", "TVDB English"],
    ["  ", "TMDB English", "TMDB English"],
    ["  ", " \n ", undefined],
  ]) {
    const tvdb = providerFixture({ requestedLanguage: "tur", englishOverview });
    const f = hookFixture({
      detail: (info, lang) => tvdb.fetchTvdbSeasonDetails("test-key", info, lang),
      synopsisGet: async () => seasonTranslations(["tr", " \n "], ["en", tmdbOverview]),
    });
    const data = await settleExplorer(f, { ...props, lang: "tr", tmdbKey: "key", tmdbTvId: 42 });
    assert.equal(data.details.get(1).overview, expected);
    if (expected) assert.equal(data.details.get(1).overviewLanguage, "en");
    f.unmount();
  }
});

test("the anime proxy uses verified requested text or its English series variant without season routes", async () => {
  for (const [proxyOverview, proxyLanguages, expected, language] of [
    ["Türkçe sezon özeti", ["tur", "eng"], "Türkçe sezon özeti", "tr"],
    ["ملخص باللغة العربية", ["ara", "eng"], "ملخص باللغة العربية", "ar"],
    [" \n ", ["tur", "eng"], "English season synopsis", "en"],
    ["Original Latin overview", ["eng"], "English season synopsis", "en"],
  ]) {
    const f = providerFixture({ proxyOverview, proxyLanguages });
    const lang = proxyLanguages.includes("ara") ? "ara" : "tur";
    const infos = await f.tvdbSeasons("", 81797, "official", lang);
    const result = await f.fetchTvdbSeasonDetails("", infos.get(1), lang);
    assert.equal(result.overview, expected);
    assert.equal(result.overviewLanguage, language);
    assert.equal(
      f.requests.some(({ url }) => url.includes("/seasons/")),
      false,
    );
    assert.equal(
      f.requests.some(({ url }) => url.includes("overviewLang=eng")),
      language === "en",
    );
  }
});

test("the anime proxy recognizes production packed language arrays for Turkish and Arabic synopses", async () => {
  for (const [lang, proxyLanguages, proxyOverview] of [
    ["tur", ["deu,eng,spa,fra,ita,tur,ind"], "Türkçe sezon özeti"],
    ["ara", ["eng,ara,tur"], "ملخص الموسم باللغة العربية"],
    ["tur", ["eng", " fra, tur, "], "Türkçe sezon özeti"],
  ]) {
    const tvdb = providerFixture({ proxyOverview, proxyLanguages });
    const infos = await tvdb.tvdbSeasons("", 81797, "official", lang);
    const result = await tvdb.fetchTvdbSeasonDetails("", infos.get(1), lang);
    assert.equal(result.overview, proxyOverview);
    assert.equal(result.overviewLanguage, episodeTextLanguage.episodeLanguageBase(lang));
    assert.equal(
      tvdb.requests.length,
      1,
      "the available translation needs no English fallback request",
    );
    const f = hookFixture({
      catalog: async () => infos,
      detail: (info, language) => tvdb.fetchTvdbSeasonDetails("", info, language),
      synopsisGet: async () => seasonTranslations(["en", "TMDB English"]),
    });
    const data = await settleExplorer(f, {
      ...props,
      tvdbKey: "",
      allowProxy: true,
      lang,
      tmdbKey: "tmdb-key",
      tmdbTvId: 42,
    });
    assert.equal(data.details.get(1).overview, proxyOverview);
    assert.equal(f.synopsisCalls.length, 0, "preferred proxy text wins over TMDB English");
    f.unmount();
  }
});

test("TMDB-only synopsis loading supports missing TVDB seasons and Specials without bulk requests", async () => {
  for (const tvdbKey of ["", "test-key"]) {
    const f = hookFixture({
      catalog: async () => new Map(),
      synopsisGet: async (_key, path) => seasonTranslations(["tr", `Türkçe ${path}`]),
    });
    const options = { ...props, lang: "tr", tvdbKey, tmdbKey: "key", tmdbTvId: 42 };
    for (const activeSeason of [1, 2, 0, 1]) {
      const data = await settleExplorer(f, { ...options, activeSeason });
      assert.equal(
        data.details.get(activeSeason).overview,
        `Türkçe tv/42/season/${activeSeason}/translations`,
      );
    }
    assert.deepEqual(
      f.synopsisCalls.map(({ path }) => path),
      ["tv/42/season/1/translations", "tv/42/season/2/translations", "tv/42/season/0/translations"],
    );
    assert.equal(f.calls.length, 0);
    f.unmount();
  }
});

test("alternate orders keep their own TVDB synopsis and never borrow TMDB text", async () => {
  const tvdb = providerFixture({ requestedLanguage: "tur" });
  const f = hookFixture({
    detail: (info, lang) => tvdb.fetchTvdbSeasonDetails("test-key", info, lang),
    synopsisGet: async () => seasonTranslations(["tr", "Wrong order synopsis"]),
  });
  const data = await settleExplorer(f, {
    ...props,
    lang: "tr",
    seasonType: "dvd",
    tmdbKey: "key",
    tmdbTvId: 42,
  });
  assert.equal(data.details.get(1).overview, "English season synopsis");
  assert.equal(f.synopsisCalls.length, 0);
  f.unmount();
});

test("TMDB retains languages unsupported by TVDB and picks the exact metadata region", async () => {
  const tvdb = providerFixture();
  const f = hookFixture({
    detail: (info, lang) => tvdb.fetchTvdbSeasonDetails("test-key", info, lang),
    synopsisGet: async () => seasonTranslations(["sw", "Muhtasari wa msimu"], ["en", "English"]),
  });
  const data = await settleExplorer(f, { ...props, lang: "sw-KE", tmdbKey: "key", tmdbTvId: 42 });
  assert.equal(data.details.get(1).overview, "Muhtasari wa msimu");
  assert.equal(f.synopsisCalls[0].params.language, "sw-KE");
  assert.equal(
    tvdb.calls.some((path) => path.endsWith("/translations/eng")),
    true,
  );
  f.unmount();
  const regional = synopsisFixture(async () =>
    seasonTranslations(
      ["pt", "Resumo português", "PT"],
      ["pt", "Resumo brasileiro", "BR"],
      ["en", "English"],
    ),
  );
  assert.equal(
    (await regional.fetchTmdbSeasonSynopsis("key", 42, 1, "pt-BR")).overview,
    "Resumo brasileiro",
  );
});

test("season synopsis language evidence rejects unknown and original-language candidates", async () => {
  const f = synopsisFixture(async () =>
    seasonTranslations(["ja", "日本語の概要"], ["en", "English fallback"]),
  );
  assert.equal((await f.fetchTmdbSeasonSynopsis("key", 42, 1, "tr")).overview, "English fallback");
  assert.deepEqual(
    {
      ...f.selectSeasonSynopsis("tr", {
        overview: "Different Latin original",
        overviewLanguage: "und",
      }),
    },
    {},
  );
  assert.equal(
    f.selectSeasonSynopsis(
      "tr",
      { overview: "English", overviewLanguage: "en" },
      { overview: "Türkçe", overviewLanguage: "tr" },
    ).overview,
    "Türkçe",
  );
  const malformed = synopsisFixture(async () => ({
    translations: [
      null,
      { iso_639_1: "tr", data: { overview: 123 } },
      ...seasonTranslations(["en", "English"]).translations,
    ],
  }));
  assert.equal((await malformed.fetchTmdbSeasonSynopsis("key", 42, 1, "tr")).overview, "English");
});

test("explicit English and Turkish season translations retain mixed-script proper names", async () => {
  for (const [lang, tvdbLang, synopsis] of [
    ["en", "eng", "The students travel to 東京 to investigate a mystery."],
    ["tr", "tur", "Öğrenciler gizemi araştırmak için 東京 şehrine gider."],
  ]) {
    const tmdb = synopsisFixture(async () =>
      seasonTranslations([lang, synopsis], ["ja", "日本語の概要"]),
    );
    const result = await tmdb.fetchTmdbSeasonSynopsis("key", 42, 1, lang);
    assert.equal(result.overview, synopsis);
    assert.equal(result.overviewLanguage, lang);
    const tvdb = providerFixture({
      requestedLanguage: tvdbLang,
      localizedOverview: synopsis,
      englishOverview: lang === "en" ? synopsis : "English fallback",
    });
    const detail = await tvdb.fetchTvdbSeasonDetails("test-key", season, lang);
    assert.equal(detail.overview, synopsis);
    assert.equal(detail.overviewLanguage, lang);
    const f = hookFixture({
      detail: () => ({ overview: "English fallback", overviewLanguage: "en" }),
      synopsisGet: async () => seasonTranslations([lang, synopsis]),
    });
    const data = await settleExplorer(f, {
      ...props,
      tvdbKey: "",
      tmdbKey: "key",
      tmdbTvId: 42,
      lang,
    });
    assert.equal(data.details.get(1).overview, synopsis);
    f.unmount();
  }
});

test("season synopsis cache deduplicates in-flight work and scopes credentials, season, language and expiry", async () => {
  let now = 0;
  const pending = deferred();
  const f = synopsisFixture(async () => pending.promise, {
    Date: class extends Date {
      static now() {
        return now;
      }
    },
  });
  const first = f.fetchTmdbSeasonSynopsis("key", 42, 1, "tr");
  const second = f.fetchTmdbSeasonSynopsis("key", 42, 1, "tr");
  assert.equal(f.calls.length, 1);
  pending.resolve(seasonTranslations(["tr", "Türkçe özet"], ["en", "English"]));
  await Promise.all([first, second]);
  await f.fetchTmdbSeasonSynopsis("key", 42, 1, "tr");
  assert.equal(f.calls.length, 1);
  await f.fetchTmdbSeasonSynopsis("other-key", 42, 1, "tr");
  await f.fetchTmdbSeasonSynopsis("key", 42, 2, "tr");
  await f.fetchTmdbSeasonSynopsis("key", 42, 1, "en");
  assert.equal(f.calls.length, 4);
  now = 10 * 60_000 + 1;
  await f.fetchTmdbSeasonSynopsis("key", 42, 1, "tr");
  assert.equal(f.calls.length, 5);
  await f.fetchTmdbSeasonSynopsis("", 42, 1, "tr");
  await f.fetchTmdbSeasonSynopsis("key", 0, 1, "tr");
  await f.fetchTmdbSeasonSynopsis("key", 42, -1, "tr");
  assert.equal(f.calls.length, 5);
});

test("failed TMDB synopsis requests retry after one minute while successful empty translations stay cached", async () => {
  let now = 0,
    attempts = 0;
  const globals = {
    Date: class extends Date {
      static now() {
        return now;
      }
    },
  };
  const f = synopsisFixture(
    async () => (++attempts === 1 ? null : seasonTranslations(["en", "Recovered"])),
    globals,
  );
  assert.equal(await f.fetchTmdbSeasonSynopsis("key", 42, 1, "tr"), null);
  assert.equal(await f.fetchTmdbSeasonSynopsis("key", 42, 1, "tr"), null);
  assert.equal(attempts, 1);
  now = 60_001;
  assert.equal((await f.fetchTmdbSeasonSynopsis("key", 42, 1, "tr")).overview, "Recovered");
  const empty = synopsisFixture(async () => seasonTranslations(["tr", " "], ["en", " "]), globals);
  await empty.fetchTmdbSeasonSynopsis("key", 42, 1, "tr");
  now += 60_001;
  assert.equal((await empty.fetchTmdbSeasonSynopsis("key", 42, 1, "tr")).overview, undefined);
  assert.equal(empty.calls.length, 1);
});

test("late TMDB synopses cannot overwrite changed language, credentials, identity, order or selection", async () => {
  for (const change of [
    { lang: "ar-SA" },
    { tmdbKey: "new-key" },
    { tmdbTvId: 43 },
    { metaId: "tmdb:tv:43", tmdbTvId: null },
    { seasonType: "dvd" },
    { activeSeason: 2 },
    { enabled: false },
  ]) {
    const pending = deferred();
    let attempts = 0;
    const f = hookFixture({
      catalog: async () => new Map(),
      synopsisGet: async () =>
        ++attempts === 1
          ? pending.promise
          : seasonTranslations(["tr", "Yeni özet"], ["ar", "ملخص جديد"]),
    });
    const options = { ...props, tvdbKey: "", tmdbKey: "key", tmdbTvId: 42, lang: "tr" };
    await settleExplorer(f, options);
    const changed = { ...options, ...change };
    await settleExplorer(f, changed);
    pending.resolve(seasonTranslations(["tr", "Eski özet"]));
    const data = await settleExplorer(f, changed);
    assert.equal(
      [...data.details.values()].some((detail) => detail.overview === "Eski özet"),
      false,
      JSON.stringify(change),
    );
    if (change.enabled === false || change.seasonType === "dvd")
      assert.equal(f.synopsisCalls.length, 1);
    f.unmount();
  }
});

test("hidden explorers and Extras make no synopsis requests even with a TMDB key", async () => {
  for (const change of [{ enabled: false }, { activeSeason: undefined }]) {
    const f = hookFixture({
      synopsisGet: async () => seasonTranslations(["en", "Should not load"]),
    });
    await settleExplorer(f, { ...props, tmdbKey: "key", tmdbTvId: 42, ...change });
    assert.equal(f.synopsisCalls.length, 0);
    assert.equal(f.calls.length, 0);
    f.unmount();
  }
});

test("unresolved raw item overviews cannot bypass the synopsis language resolver", () => {
  const SeasonExplorer = seasonExplorerComponent();
  const html = renderToStaticMarkup(
    React.createElement(SeasonExplorer, {
      activeKey: "1",
      onSelect: () => {},
      data: {
        items: [
          {
            key: "1",
            seasonNumber: 1,
            name: "Season 1",
            count: 12,
            overview: "Unchecked original synopsis",
          },
        ],
        seasons: new Map(),
        names: new Map(),
        details: new Map(),
        artwork: new Map(),
        loading: false,
        setVisibleSeasons: () => {},
      },
    }),
  );
  assert.doesNotMatch(html, /Unchecked original synopsis/);
  assert.match(html, /No season synopsis available/);
});

test("season title stays English while the synopsis follows the metadata language", async () => {
  const f = providerFixture({ localizedOverview: "Résumé français" });
  const result = await fetchCompleteSeason(f, "test-key", season, "fra");
  assert.equal(result.name, "English Saga");
  assert.equal(result.overview, "Résumé français");
});

test("missing English translation never falls back to a foreign or original title", async () => {
  const f = providerFixture({ localizedOverview: "Résumé français", missingEnglish: true });
  const result = await fetchCompleteSeason(f, "test-key", { ...season, name: "日本語" }, "fra");
  assert.equal(result.name, undefined);
  assert.equal(result.overview, "Résumé français");
});

test("poster and dropdown items share English titles and preserve season identity", () => {
  const { englishSeasonItems } = hookFixture();
  const items = [
    { key: "4", seasonNumber: 4, name: "日本語", count: 12 },
    { key: "5", seasonNumber: 5, name: "Saison cinq", count: 20 },
    { key: "0", seasonNumber: 0, name: "特別", count: 3 },
    { key: "extra", name: "Movie", count: 1 },
  ];
  const names = new Map([[4, "High School DxD HERO"]]);
  const result = englishSeasonItems(items, names, new Map());
  assert.equal(result[0].name, "High School DxD HERO");
  assert.equal(result[0].seasonNumber, 4);
  assert.equal(result[0].count, 12);
  assert.equal(result[0].isGenericName, false);
  assert.equal(result[1].name, "Season 5");
  assert.equal(result[1].isGenericName, true);
  assert.equal(result[2].name, "Specials");
  assert.equal(result[3], items[3]);
  assert.equal(items[0].name, "日本語");
});

test("hidden explorer views do not request season metadata", async () => {
  const f = hookFixture();
  f.render({ ...props, enabled: false });
  await flush();
  f.render({ ...props, enabled: false });
  assert.equal(f.calls.length, 0);
  f.unmount();
});

function seasonExplorerComponent({
  react = React,
  visibility = { observeWithin: () => () => {} },
  globals = {},
  artworkHook,
  horizontalScroll,
  translate,
  reducedMotion = false,
} = {}) {
  const noop = () => {};
  const fallbackArtwork = new Map();
  const fallbackVisible = [];
  const { SeasonExplorer } = load(
    "src/views/detail/season-explorer.tsx",
    {
      react: { memo: React.memo, ...react },
      "@/lib/remote-image-proxy": { useProxiedImageSrc: (url) => url },
      "./use-season-explorer": {
        useSeasonExplorerArtwork:
          artworkHook ??
          ((data) => ({
            artwork: data.artwork ?? fallbackArtwork,
            visibleSeasons: fallbackVisible,
            setVisibleSeasons: data.setVisibleSeasons ?? noop,
            onPosterError: data.onPosterError ?? noop,
          })),
      },
      "react/jsx-runtime": jsxRuntime,
      "lucide-react": {
        Film: () => null,
        CalendarDays: () => null,
        ChevronLeft: () => null,
        ChevronRight: () => null,
      },
      "@/lib/visibility": { observeResize: () => () => {}, ...visibility },
      "@/lib/horizontal-scroll": {
        horizontalScrollState: horizontalScroll ?? (() => ({ rtl: false, max: 0, position: 0 })),
      },
      "@/lib/use-reduced-motion": { useReducedMotion: () => reducedMotion },
      "@/lib/use-drag-scroll": {
        useDragScroll: (options = {}) => ({
          ref: options.elementRef ?? { current: null },
          handlers: {},
        }),
      },
      "./season-explorer.css": {},
      "@/components/player/subtitle-menu/marquee-motion": load(
        "src/components/player/subtitle-menu/marquee-motion.ts",
        {},
      ),
      "@/lib/i18n": {
        useT: () => translate ?? ((key, vars) => key.replace("{n}", String(vars?.n ?? ""))),
      },
      "@/lib/season-name": { isGenericSeasonName: (name, n) => name === `Season ${n}` },
      "./synopsis": { Synopsis: ({ text }) => React.createElement("p", null, text) },
    },
    globals,
  );
  return SeasonExplorer;
}

test("English season titles render beside the original dropdown-style number badge", () => {
  const SeasonExplorer = seasonExplorerComponent();
  const html = renderToStaticMarkup(
    React.createElement(SeasonExplorer, {
      activeKey: "4",
      onSelect: () => {},
      data: {
        items: [{ key: "4", seasonNumber: 4, name: "High School DxD HERO", count: 12 }],
        seasons: new Map(),
        names: new Map(),
        artwork: new Map(),
        setVisibleSeasons: () => {},
        loading: false,
        details: new Map([[4, { overview: "Résumé français" }]]),
      },
    }),
  );
  assert.match(html, /aria-label="Season 4 · High School DxD HERO · 12 episodes"/);
  assert.equal((html.match(/>Season 4<\/span>/g) ?? []).length, 2);
  assert.match(
    html,
    /rounded bg-ink\/10 px-1.5 py-px text-\[10.5px\] font-semibold text-ink-muted/,
  );
  assert.match(html, /Résumé français/);
});

test("season catalog names use proxy base data and direct-key English translations", async () => {
  const f = providerFixture();
  assert.equal((await f.tvdbSeasonNames("test-key", 81797, "official")).get(1), "English Saga");
  assert.equal((await f.tvdbSeasonNames("", 81797, "official")).get(1), "Saga française");
  const unavailable = providerFixture({ missingEnglish: true });
  assert.equal((await unavailable.tvdbSeasonNames("test-key", 81797, "official")).size, 0);
});

test("season row excludes Extras while retaining season zero and episode-picker entries", () => {
  const SeasonExplorer = seasonExplorerComponent();
  const items = Object.freeze([
    Object.freeze({ key: "4", seasonNumber: 4, name: "English Saga", count: 12 }),
    Object.freeze({ key: "0", seasonNumber: 0, name: "Specials", count: 63, extra: true }),
    Object.freeze({ key: "specials", name: "Extras", count: 231, extra: true }),
    Object.freeze({ key: "-1", seasonNumber: -1, name: "Other extras", count: 2, extra: true }),
  ]);
  const data = {
    items,
    seasons: new Map(),
    names: new Map(),
    details: new Map(),
    artwork: new Map(),
    setVisibleSeasons: () => {},
    loading: false,
  };
  for (const activeKey of ["4", "specials"]) {
    const html = renderToStaticMarkup(
      React.createElement(SeasonExplorer, { data, activeKey, onSelect: () => {} }),
    );
    assert.match(html, /aria-label="Season 4 · English Saga · 12 episodes"/);
    assert.match(html, /aria-label="Specials · 63 episodes"/);
    assert.doesNotMatch(html, /Extras|Other extras|231 episodes/);
    if (activeKey === "specials") {
      assert.doesNotMatch(html, /aria-pressed="true"|aria-live="polite"/);
    }
  }
  assert.equal(data.items.length, 4);
  assert.equal(data.items[2].name, "Extras");
  assert.equal(
    renderToStaticMarkup(
      React.createElement(SeasonExplorer, {
        data: { ...data, items: [items[2], items[3]] },
        activeKey: "specials",
        onSelect: () => {},
      }),
    ),
    "",
  );
});

test("artwork and text load independently and concurrent artwork consumers share a request", async () => {
  const f = providerFixture();
  const [first, second] = await Promise.all([
    f.fetchTvdbSeasonArtwork("test-key", season, "fra"),
    f.fetchTvdbSeasonArtwork("test-key", season, "fra"),
  ]);
  assert.equal(first.poster, "https://artworks.thetvdb.com/french.jpg");
  assert.equal(second.poster, first.poster);
  assert.equal(f.calls.filter((path) => path.endsWith("/extended")).length, 1);
  assert.equal(f.calls.filter((path) => path.includes("/translations/")).length, 0);
  await f.fetchTvdbSeasonDetails("test-key", season, "fra");
  assert.equal(f.calls.filter((path) => path.endsWith("/extended")).length, 1);
  assert.equal(f.calls.filter((path) => path.includes("/translations/")).length, 2);
  const textOnly = providerFixture();
  await textOnly.fetchTvdbSeasonDetails("test-key", season, "eng");
  assert.equal(textOnly.calls.filter((path) => path.endsWith("/extended")).length, 0);
});

test("visible posters resolve before selection and stay stable when clicking and revisiting", async () => {
  const f = hookFixture();
  f.render(props);
  await flush();
  let result = f.render(props);
  result.setVisibleSeasons([1, 2]);
  await flush();
  f.render(props);
  await flush();
  result = f.render(props);
  const secondPoster = result.artwork.get(2).poster;
  assert.equal(secondPoster, "/preferred-31894.jpg");
  assert.equal(result.details.has(2), false);
  assert.deepEqual(
    f.calls.map((call) => call.number),
    [1],
  );
  f.render({ ...props, activeSeason: 2 });
  await flush();
  result = f.render({ ...props, activeSeason: 2 });
  assert.equal(result.artwork.get(2).poster, secondPoster);
  f.render(props);
  await flush();
  assert.deepEqual(f.artworkCalls, [31893, 31894]);
  assert.deepEqual(
    f.calls.map((call) => call.number),
    [1, 2],
  );
  f.unmount();
});

test("artwork requests stay bounded, prioritize selection, and skip offscreen seasons and Extras", async () => {
  const blocked = new Map(Array.from({ length: 8 }, (_, i) => [i, deferred()]));
  const f = hookFixture({
    catalog: async () =>
      new Map(
        Array.from({ length: 9 }, (_, i) => [i - 1, { ...season, number: i - 1, id: i - 1 }]),
      ),
    artwork: (id) => blocked.get(id).promise,
  });
  f.render(props);
  await flush();
  let result = f.render(props);
  result.setVisibleSeasons([-1, 0, 1, 2, 3, 4, 5]);
  f.render(props);
  assert.deepEqual(f.artworkCalls, [1, 0, 2]);
  f.render({ ...props, activeSeason: 5 });
  assert.equal(f.artworkCalls.length, 3);
  blocked.get(0).resolve({ image: "/specials.jpg", artwork: [] });
  await flush();
  assert.deepEqual(f.artworkCalls, [1, 0, 2, 5]);
  blocked.get(5).resolve({ image: "/five.jpg", artwork: [] });
  await flush();
  result = f.render({ ...props, activeSeason: 5 });
  assert.equal(result.artwork.get(5).poster, "/five.jpg");
  assert.equal(result.artwork.get(0).poster, "/specials.jpg");
  assert.equal(f.artworkCalls.includes(-1), false);
  assert.equal(f.artworkCalls.includes(6), false);
  assert.equal(f.artworkCalls.includes(7), false);
  f.unmount();
  for (const pending of blocked.values()) pending.resolve({ artwork: [] });
  await flush();
  assert.equal(f.artworkCalls.includes(4), false);
});

test("late artwork is discarded across title, language, order, API mode, and hidden-view changes", async () => {
  for (const changed of [
    { metaId: "kitsu:99" },
    { lang: "fra" },
    { seasonType: "dvd" },
    { tvdbKey: "" },
    { enabled: false },
  ]) {
    const pending = deferred();
    const f = hookFixture({ artwork: () => pending.promise });
    f.render(props);
    await flush();
    f.render(props);
    const nextProps = { ...props, ...changed };
    const hidden = f.render(nextProps);
    assert.equal(hidden.artwork.size, 0);
    pending.resolve({ image: "/stale.jpg", artwork: [] });
    await flush();
    // The replacement catalog has not yet been consumed by an effect.
    const next = f.render(nextProps);
    assert.equal(next.artwork.size, 0);
    f.unmount();
  }
});

test("failed artwork resolves to the default once and clicking does not retry it", async () => {
  const f = hookFixture({
    artwork: async () => {
      throw new Error("unavailable");
    },
  });
  f.render(props);
  await flush();
  f.render(props);
  await flush();
  let result = f.render(props);
  assert.equal(result.artwork.get(1).poster, season.image);
  result.setVisibleSeasons([1, 2]);
  f.render(props);
  await flush();
  f.render({ ...props, activeSeason: 2 });
  await flush();
  result = f.render(props);
  assert.equal(result.artwork.get(1).poster, season.image);
  assert.deepEqual(f.artworkCalls, [31893, 31894]);
  f.unmount();
});

test("poster cards and the selected panel use the same artwork and hide default posters while pending", () => {
  const SeasonExplorer = seasonExplorerComponent();
  const data = {
    items: [
      { key: "1", seasonNumber: 1, name: "Season 1", count: 10 },
      { key: "2", seasonNumber: 2, name: "Season 2", count: 10 },
    ],
    seasons: new Map([
      [1, { image: "/base-one.jpg" }],
      [2, { image: "/base-two.jpg" }],
    ]),
    artwork: new Map([
      [1, { poster: "/preferred-one.jpg" }],
      [2, { poster: "/preferred-two.jpg" }],
    ]),
    details: new Map([[1, { poster: "/wrong-detail.jpg", overview: "First synopsis" }]]),
    setVisibleSeasons: () => {},
    loading: false,
  };
  for (const activeKey of ["1", "2"]) {
    const html = renderToStaticMarkup(
      React.createElement(SeasonExplorer, {
        data,
        activeKey,
        onSelect: () => {},
      }),
    );
    assert.equal(
      (
        html.match(
          new RegExp('src="/preferred-' + (activeKey === "1" ? "one" : "two") + '.jpg"', "g"),
        ) ?? []
      ).length,
      2,
    );
    assert.doesNotMatch(html, /base-one|base-two|wrong-detail/);
  }
  const pending = renderToStaticMarkup(
    React.createElement(SeasonExplorer, {
      data: { ...data, artwork: new Map() },
      activeKey: "1",
      onSelect: () => {},
    }),
  );
  assert.doesNotMatch(pending, /base-one|base-two|wrong-detail/);
});

test("season-strip visibility reports nearby cards to the artwork loader without selecting them", async () => {
  const f = hookFixture();
  f.render(props);
  await flush();
  const data = f.render(props);
  const cards = [1, 2].map((n) => ({ dataset: { seasonNumber: String(n) } }));
  const rail = { querySelectorAll: () => cards };
  const effects = [],
    observations = [];
  let released = 0;
  const SeasonExplorer = seasonExplorerComponent({
    react: {
      ...React,
      useRef: () => ({ current: rail }),
      useId: () => "season",
      useMemo: (compute) => compute(),
      useState: (initial) => [initial, () => {}],
      useEffect: (effect) => effects.push(effect),
      useCallback: (callback) => callback,
    },
    visibility: {
      observeWithin: (card, margin, callback, root) => {
        observations.push({ card, margin, callback, root });
        return () => {
          released++;
        };
      },
    },
  });
  SeasonExplorer({
    data: {
      ...data,
      items: cards.map((card) => ({
        key: card.dataset.seasonNumber,
        seasonNumber: Number(card.dataset.seasonNumber),
        name: "Season",
        count: 10,
      })),
    },
    activeKey: "1",
    onSelect: () => {
      throw new Error("visibility must not select a season");
    },
  });
  const cleanup = effects[0]();
  assert.equal(observations.length, 2);
  for (const observation of observations) {
    assert.equal(observation.root, rail);
    assert.equal(observation.margin, "0px 180px");
    observation.callback({ isIntersecting: true });
  }
  await flush();
  f.render(props);
  await flush();
  assert.deepEqual(f.artworkCalls, [31893, 31894]);
  assert.deepEqual(
    f.calls.map((call) => call.number),
    [1],
  );
  cleanup();
  assert.equal(released, 2);
  f.unmount();
});

test("poster image errors are shared and a replacement scope can reuse a previously failed URL", () => {
  const state = [];
  const errors = [];
  let index = 0;
  const SeasonExplorer = seasonExplorerComponent({
    react: {
      ...React,
      useRef: () => ({ current: null }),
      useId: () => "season",
      useMemo: (compute) => compute(),
      useState: (initial) => {
        const position = index++;
        if (!(position in state)) state[position] = initial;
        return [
          state[position],
          (value) => {
            state[position] = typeof value === "function" ? value(state[position]) : value;
          },
        ];
      },
      useEffect: () => {},
      useCallback: (callback) => callback,
    },
  });
  const tree = SeasonExplorer({
    data: {
      items: [{ key: "1", seasonNumber: 1, name: "Season 1", count: 10 }],
      seasons: new Map([[1, { image: "/base.jpg" }]]),
      artwork: new Map([[1, { poster: "/preferred.jpg" }]]),
      onPosterError: (_number, url) => errors.push(url),
      details: new Map(),
      setVisibleSeasons: () => {},
      loading: false,
    },
    activeKey: "1",
    onSelect: () => {},
  });
  function findPoster(node) {
    if (node?.type?.name === "SeasonPoster") return node;
    if (node?.type?.type) return findPoster(node.type.type(node.props));
    for (const child of [node?.props?.children].flat()) {
      const found = child && findPoster(child);
      if (found) return found;
    }
  }
  const poster = findPoster(tree);
  assert.ok(poster);
  const stateStart = state.length;
  const render = (src) => {
    index = stateStart;
    return poster.type({ ...poster.props, src });
  };
  let image = render(poster.props.src);
  assert.equal(image.props.src, "/preferred.jpg");
  image.props.onError();
  assert.equal(render(undefined).type, "div");
  image = render("/base.jpg");
  assert.equal(image.props.src, "/base.jpg");
  image.props.onError();
  assert.equal(render(undefined).type, "div");
  assert.equal(render("/preferred.jpg").props.src, "/preferred.jpg");
  assert.deepEqual(errors, ["/preferred.jpg", "/base.jpg"]);
});

test("failed synopsis loads retry on revisit without retrying successful empty responses", async () => {
  for (const failure of ["reject", "unavailable"]) {
    let attempts = 0;
    const f = hookFixture({
      detail: (info) => {
        if (info.number !== 1) return { overview: "Second synopsis" };
        if (++attempts === 1) {
          if (failure === "reject") throw new Error("temporary outage");
          return null;
        }
        return { overview: "Recovered synopsis" };
      },
    });
    f.render(props);
    await flush();
    f.render(props);
    await flush();
    assert.equal(f.render(props).details.has(1), false);
    assert.equal(f.render(props).loading, false);
    assert.equal(attempts, 1);
    f.render({ ...props, activeSeason: 2 });
    await flush();
    f.render(props);
    await flush();
    assert.equal(f.render(props).details.get(1).overview, "Recovered synopsis");
    f.unmount();
  }
  const f = hookFixture({ detail: () => ({}) });
  f.render(props);
  await flush();
  f.render(props);
  await flush();
  f.render({ ...props, activeSeason: 2 });
  await flush();
  f.render(props);
  assert.equal(f.calls.filter((call) => call.number === 1).length, 1);
  f.unmount();
});

test("unavailable season translations remain distinguishable from a successful empty translation", async () => {
  const unavailable = providerFixture({ fail: true });
  assert.equal(await unavailable.fetchTvdbSeasonDetails("test-key", season, "eng"), null);
});

test("English season fallback preserves source provenance without accepting unknown or foreign names", () => {
  const { englishSeasonItems } = hookFixture();
  const original = [
    { key: "4", seasonNumber: 4, name: "The Final Season", nameLanguage: "en", count: 12 },
    { key: "5", seasonNumber: 5, name: "La dernière saison", nameLanguage: "fr", count: 12 },
    { key: "6", seasonNumber: 6, name: "Saigo no Kisetsu", nameLanguage: "und", count: 12 },
  ];
  const fallback = englishSeasonItems(original, new Map(), new Map());
  assert.equal(fallback[0].name, "The Final Season");
  assert.equal(fallback[0].isGenericName, false);
  assert.equal(fallback[1].name, "Season 5");
  assert.equal(fallback[2].name, "Season 6");
  const translated = englishSeasonItems(original, new Map([[4, "TVDB English Arc"]]), new Map());
  assert.equal(translated[0].name, "TVDB English Arc");
});

test("a Japanese season detail name cannot override the English fallback", () => {
  const { englishSeasonItems } = hookFixture();
  const result = englishSeasonItems(
    [{ key: "1", seasonNumber: 1, name: "Season 1", fallbackName: "Season 1", count: 12 }],
    new Map(),
    new Map([[1, { name: "シーズン1" }]]),
  );
  assert.equal(result[0].name, "Season 1");
});

test("a generic TVDB English name never replaces a real English season title", () => {
  const { englishSeasonItems } = hookFixture();
  const items = [
    { key: "4", seasonNumber: 4, name: "The Final Season", nameLanguage: "en", count: 12 },
  ];
  const fromOrder = englishSeasonItems(items, new Map([[4, "Season 4"]]), new Map());
  assert.equal(fromOrder[0].name, "The Final Season");
  assert.equal(fromOrder[0].isGenericName, false);
  const fromDetail = englishSeasonItems(items, new Map(), new Map([[4, { name: "Season 4" }]]));
  assert.equal(fromDetail[0].name, "The Final Season");
});

test("TMDB English season names survive both default and TVDB-fallback picker paths", async () => {
  const seasonNames = load("src/lib/season-name.ts", {});
  async function metadata(name, lang) {
    const requests = [];
    const { tmdbDetails } = load("src/lib/providers/tmdb/tmdb-details.ts", {
      "./movie-release-dates": load("src/lib/providers/tmdb/movie-release-dates.ts", {}),
      "./tmdb-client": {
        IMG: "https://image.invalid",
        effectiveTmdbLanguage: () => lang,
        get: async (_key, path) => {
          requests.push(path);
          return path === "tv/42"
            ? {
                id: 42,
                name: "Example",
                images: {},
                seasons: [
                  { id: 44, season_number: 4, name, episode_count: 12, poster_path: "/final.jpg" },
                  {
                    id: 40,
                    season_number: 0,
                    name: "Specials",
                    episode_count: 4,
                    poster_path: "/specials.jpg",
                  },
                ],
              }
            : {};
        },
      },
      "./tmdb-image-rungs": {
        tmdbBackdropUrl: () => undefined,
        tmdbPosterUrl: (path) => (path ? `https://image.tmdb.org/t/p/w500${path}` : undefined),
      },
      "@/lib/settings/load": { loadStoredSettings: () => ({}) },
      "./tmdb-images": { pickLogo: () => undefined },
      "./tmdb-image-lang": { imageLangParam: () => "en", imageLangRank: () => 0 },
      "./tmdb-trailers": { pickTrailers: () => [] },
      "./tmdb-meta-mappers": { isAnimeItem: () => false },
      "./tmdb-title-fallback": tmdbTitleFallback,
      "@/lib/storage-recovery": {},
      "@/lib/episode-text-language": episodeTextLanguage,
      "@/lib/season-name": seasonNames,
    });
    const detail = await tmdbDetails("test-key", { id: "tmdb:tv:42", type: "series" });
    return {
      seasons: detail.seasons,
      requests,
      seasonPosters: detail.seasonPosters,
      tmdbTvId: detail.tmdbTvId,
    };
  }
  const english = await metadata("The Final Season", "en-US");
  assert.equal(english.seasons[0].nameLanguage, "en");
  assert.equal(english.requests.length, 1);
  assert.equal(english.tmdbTvId, 42);
  assert.deepEqual(
    Array.from(english.seasons, (s) => s.seasonNumber),
    [4],
  );
  assert.equal(english.seasonPosters[0], "https://image.tmdb.org/t/p/w500/specials.jpg");
  assert.equal((await metadata("La dernière saison", "fr")).seasons[0].nameLanguage, "und");
  assert.equal((await metadata("最終章", "en")).seasons[0].nameLanguage, "und");
  const { useSeasonArcPicker } = load("src/views/detail/series-episodes/use-season-arc-picker.ts", {
    react: { useMemo: (compute) => compute() },
    "@/lib/season-view-pref": {},
    "@/lib/providers/tvdb-order": {
      seasonDateRange: () => ({}),
      isGenericTvdbSeasonName: (name, n) => name === `Season ${n}`,
    },
    "../helpers": { isNewSeason: () => false },
    "@/lib/season-name": seasonNames,
  });
  const { englishSeasonItems } = hookFixture();
  for (const source of ["default", "order"]) {
    const picker = useSeasonArcPicker({
      source,
      arc: {},
      seasons: english.seasons,
      active: 4,
      orderSeasonEff: 4,
      ordering: {
        seasons: [{ seasonNumber: 4, name: "Season 4", episodeCount: 12 }],
        bySeason: new Map(),
      },
      tmdbSeasonNameFallback: true,
    });
    const [item] = englishSeasonItems(picker.items, new Map(), new Map());
    assert.equal(item.name, "The Final Season");
    assert.equal(item.nameLanguage, "en");
  }
});

test("TMDB posters and synopses stay out of non-aired order views", () => {
  const seasonNames = load("src/lib/season-name.ts", {});
  const { useSeasonArcPicker } = load("src/views/detail/series-episodes/use-season-arc-picker.ts", {
    react: { useMemo: (compute) => compute() },
    "@/lib/season-view-pref": {},
    "@/lib/providers/tvdb-order": {
      seasonDateRange: () => ({}),
      isGenericTvdbSeasonName: (name, n) => name === `Season ${n}`,
    },
    "../helpers": { isNewSeason: () => false },
    "@/lib/season-name": seasonNames,
  });
  const seasons = [
    {
      seasonNumber: 2,
      name: "TMDB Season 2",
      nameLanguage: "en",
      overview: "TMDB synopsis",
      episodeCount: 10,
    },
  ];
  const ordering = {
    seasons: [
      {
        seasonNumber: 2,
        name: "Season 2",
        episodeCount: 10,
        overview: "TVDB synopsis",
        isGenericName: true,
      },
    ],
    bySeason: new Map(),
  };
  const base = {
    source: "order",
    arc: {},
    ordering,
    seasons,
    active: 2,
    orderSeasonEff: 2,
    metaId: "tt1",
    setActive: () => {},
    setOrderSeason: () => {},
    userPickedRef: { current: false },
    seasonPosters: { 2: "https://image.tmdb.org/t/p/w500/tmdb.jpg" },
  };
  const aired = useSeasonArcPicker({ ...base, tmdbSeasonNameFallback: true });
  assert.equal(aired.items[0].name, "TMDB Season 2");
  assert.equal(aired.items[0].poster, "https://image.tmdb.org/t/p/w500/tmdb.jpg");
  assert.equal(aired.items[0].overview, "TMDB synopsis");
  const dvd = useSeasonArcPicker({ ...base, tmdbSeasonNameFallback: false });
  assert.equal(dvd.items[0].name, "Season 2");
  assert.equal(dvd.items[0].poster, undefined);
  assert.equal(dvd.items[0].overview, "TVDB synopsis");
});

function hookRuntime(initialRef = null) {
  const slots = [],
    effects = [];
  let index = 0,
    dirty = true;
  const memo = (compute, deps) => {
    const position = index++,
      previous = slots[position];
    if (!previous || !deps.every((value, i) => Object.is(value, previous.deps[i])))
      slots[position] = { deps, value: compute() };
    return slots[position].value;
  };
  const react = {
    useMemo: memo,
    useCallback: (callback, deps) => memo(() => callback, deps),
    useId: () => "id-" + index++,
    useRef: (initial) => {
      const position = index++;
      return (slots[position] ??= { current: initial == null ? (initialRef ?? initial) : initial });
    },
    useState: (initial) => {
      const position = index++;
      if (!(position in slots)) {
        const slot = { value: typeof initial === "function" ? initial() : initial };
        slot.set = (value) => {
          const next = typeof value === "function" ? value(slot.value) : value;
          if (!Object.is(next, slot.value)) {
            slot.value = next;
            dirty = true;
          }
        };
        slots[position] = slot;
      }
      return [slots[position].value, slots[position].set];
    },
    useEffect: (effect, deps) => {
      const position = index++,
        previous = slots[position];
      if (!previous || !deps.every((value, i) => Object.is(value, previous.deps[i])))
        effects.push(() => {
          previous?.cleanup?.();
          slots[position] = { deps, cleanup: effect() };
        });
    },
  };
  return {
    react,
    render: (compute) => {
      index = 0;
      dirty = false;
      return compute();
    },
    commit: () => effects.splice(0).forEach((effect) => effect()),
    unmount: () => slots.forEach((slot) => slot.cleanup?.()),
    get dirty() {
      return dirty;
    },
  };
}

test("current series hooks settle with two visible cards even when item arrays are recreated", async () => {
  const cards = [1, 2].map((n) => ({ dataset: { seasonNumber: String(n) } }));
  const rail = { querySelectorAll: () => cards, querySelector: () => null };
  const parent = hookRuntime(),
    child = hookRuntime(rail);
  const react = parent.react,
    noop = () => {};
  const userPickedRef = { current: false };
  const seasons = [1, 2].map((n) => ({
    id: n,
    seasonNumber: n,
    name: "Season " + n,
    episodeCount: 12,
  }));
  const infos = new Map(seasons.map((s) => [s.id, { id: s.id, number: s.id }]));
  const { useArcGroups } = load("src/views/detail/series-episodes/use-arc-groups.ts", {
    react,
    "@/lib/providers/tmdb": {},
  });
  const { useSeasonArcPicker } = load("src/views/detail/series-episodes/use-season-arc-picker.ts", {
    react,
    "@/lib/season-view-pref": {},
    "@/lib/providers/tvdb-order": {},
    "../helpers": { isNewSeason: () => false },
    "@/lib/season-name": {},
  });
  const { useSeasonExplorerView } = load("src/views/detail/use-season-explorer.ts", {
    react,
    "@/lib/providers/anime-mapping": {},
    "@/lib/episode-text-language": episodeTextLanguage,
    "@/lib/providers/season-synopsis": synopsisFixture(),
    "@/lib/providers/tmdb-season-artwork": {},
    "@/lib/providers/kitsu": { parseKitsuId: () => null },
    "@/lib/season-name": { isGenericSeasonName: () => true },
    "@/lib/providers/tvdb": {
      tvdbLangFromIso1: tvdbLanguage,
      isDisplayableName: (value) => !/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/.test(value),
      tvdbSeasons: async () => infos,
      tvdbSeasonNames: async () => new Map(),
      tvdbSeriesByRemote: async () => 42,
    },
    "@/lib/providers/tvdb-season-details": {
      createSeasonArtworkLoader: () => ({ request: noop, dispose: noop }),
      fetchTvdbSeasonDetails: async () => ({}),
    },
  });
  const registrations = new Set();
  let subscriptions = 0,
    previousItems,
    settled = false;
  const SeasonExplorer = seasonExplorerComponent({
    react: child.react,
    globals: {
      ResizeObserver: class {
        observe() {}
        disconnect() {}
      },
    },
    visibility: {
      observeWithin: (_card, _margin, callback) => {
        subscriptions++;
        registrations.add(callback);
        return () => registrations.delete(callback);
      },
    },
  });
  for (let frame = 0; frame < 8; frame++) {
    const data = parent.render(() => {
      const arc = useArcGroups({ tvId: 42, tmdbKey: "", enabled: false });
      const picker = useSeasonArcPicker({
        source: "default",
        arc,
        seasons,
        active: 1,
        metaId: "tt123",
        setActive: noop,
        setOrderSeason: noop,
        userPickedRef,
      });
      if (previousItems && frame > 1) assert.equal(picker.items, previousItems);
      previousItems = picker.items;
      return useSeasonExplorerView({
        metaId: "tt123",
        tvdbKey: "",
        seasonType: "official",
        lang: "eng",
        items: [...picker.items],
        activeKey: "1",
      });
    });
    child.render(() => SeasonExplorer({ data, activeKey: "1", onSelect: noop }));
    parent.commit();
    child.commit();
    if (frame === 0) for (const callback of registrations) callback({ isIntersecting: true });
    await flush();
    if (!parent.dirty && !child.dirty) {
      settled = true;
      break;
    }
  }
  assert.equal(settled, true, "idle visibility updates must settle");
  assert.equal(subscriptions, 2, "same cards must keep their observers across refreshed arrays");
  child.unmount();
  parent.unmount();
  assert.equal(registrations.size, 0);
});

test("visibility changes publish one complete set and discard queued updates after cleanup", async () => {
  const cards = [1, 2].map((n) => ({ dataset: { seasonNumber: String(n) } }));
  const effects = [],
    callbacks = [],
    updates = [];
  const rail = { querySelectorAll: () => cards };
  const SeasonExplorer = seasonExplorerComponent({
    react: {
      ...React,
      useRef: () => ({ current: rail }),
      useId: () => "season",
      useMemo: (compute) => compute(),
      useState: (initial) => [initial, () => {}],
      useEffect: (effect) => effects.push(effect),
      useCallback: (callback) => callback,
    },
    visibility: {
      observeWithin: (_card, _margin, callback) => {
        callbacks.push(callback);
        return () => {};
      },
    },
  });
  SeasonExplorer({
    data: {
      items: cards.map((card) => ({
        key: card.dataset.seasonNumber,
        seasonNumber: Number(card.dataset.seasonNumber),
        name: "Season",
        count: 12,
      })),
      seasons: new Map(),
      details: new Map(),
      artwork: new Map(),
      setVisibleSeasons: (numbers) => updates.push([...numbers]),
    },
    activeKey: "1",
    onSelect: () => {},
  });
  const cleanup = effects[0]();
  for (const callback of callbacks) callback({ isIntersecting: true });
  assert.equal(updates.length, 0);
  await flush();
  assert.deepEqual(updates, [[1, 2]]);
  callbacks[0]({ isIntersecting: false });
  cleanup();
  await flush();
  assert.deepEqual(updates, [[1, 2]]);
});

test("TMDB season artwork supports Specials, language priority, caching, and rejected images", async () => {
  const f = tmdbArtworkFixture(async () => ({
    posters: [
      { file_path: "/japanese.jpg", iso_639_1: "ja", vote_average: 100 },
      { file_path: "/textless.jpg", iso_639_1: null, vote_average: 99 },
      { file_path: "/english.jpg", iso_639_1: "en", vote_average: 50 },
      { file_path: "/french.jpg", iso_639_1: "fr", vote_average: 1 },
    ],
  }));
  const [first, second] = await Promise.all([
    f.fetchTmdbSeasonPoster("test-key", 42, 0, "fra"),
    f.fetchTmdbSeasonPoster("test-key", 42, 0, "fra"),
  ]);
  assert.equal(first, "https://image.tmdb.org/t/p/w500/french.jpg");
  assert.equal(second, first);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].path, "tv/42/season/0/images");
  assert.equal(f.calls[0].params.include_image_language, "fr,en,null");
  const rejected = new Set([first]);
  const english = await f.fetchTmdbSeasonPoster("test-key", 42, 0, "fra", rejected);
  assert.equal(english, "https://image.tmdb.org/t/p/w500/english.jpg");
  rejected.add(english);
  const textless = await f.fetchTmdbSeasonPoster("test-key", 42, 0, "fra", rejected);
  assert.equal(textless, "https://image.tmdb.org/t/p/w500/textless.jpg");
  rejected.add(textless);
  assert.equal(await f.fetchTmdbSeasonPoster("test-key", 42, 0, "fra", rejected), undefined);
  assert.equal(f.calls.length, 1, "changing candidates must reuse the same image response");
  await f.fetchTmdbSeasonPoster("other-key", 42, 0, "fra");
  await f.fetchTmdbSeasonPoster("test-key", 42, 0, "eng");
  assert.equal(f.calls.length, 3, "credentials and language scope the cache");
});

test("TMDB artwork identity accepts exact TV mappings and rejects movie-only or ambiguous results", async () => {
  const f = tmdbArtworkFixture(async (_key, path) => ({
    tv_results: path.endsWith("tt1")
      ? [{ id: 42 }]
      : path.endsWith("tt2")
        ? []
        : [{ id: 42 }, { id: 43 }],
    movie_results: [{ id: 100 }],
  }));
  assert.equal(await f.resolveSeasonArtworkTmdbId("", "kitsu:1", null, 42), 42);
  assert.equal(await f.resolveSeasonArtworkTmdbId("", "tmdb:tv:42"), 42);
  assert.equal(f.calls.length, 0);
  assert.equal(await f.resolveSeasonArtworkTmdbId("test-key", "addon:show", "tt1"), 42);
  assert.equal(await f.resolveSeasonArtworkTmdbId("test-key", "addon:show", "tt2"), null);
  assert.equal(await f.resolveSeasonArtworkTmdbId("test-key", "addon:show", "tt3"), null);
  assert.equal(await f.resolveSeasonArtworkTmdbId("", "addon:show", "tt1"), null);
  assert.equal(
    f.calls.every((call) => call.path.startsWith("find/")),
    true,
  );
});

async function settleExplorer(f, options) {
  for (let i = 0; i < 3; i++) {
    f.render(options);
    await flush();
  }
  return f.render(options);
}

test("season cards use TMDB posters and resolved overviews when TVDB is unavailable", () => {
  const SeasonExplorer = seasonExplorerComponent();
  const html = renderToStaticMarkup(
    React.createElement(SeasonExplorer, {
      activeKey: "4",
      onSelect: () => {},
      data: {
        items: [
          {
            key: "4",
            seasonNumber: 4,
            name: "The Final Season",
            count: 12,
            poster: "https://image.tmdb.org/t/p/w500/final.jpg",
            overview: "Résumé français",
          },
        ],
        seasons: new Map(),
        names: new Map(),
        artwork: new Map(),
        setVisibleSeasons: () => {},
        loading: false,
        details: new Map([[4, { overview: "Résumé français", overviewLanguage: "fr" }]]),
      },
    }),
  );
  assert.match(html, /final\.jpg/);
  assert.match(html, /Résumé français/);
});

test("a single season plus Specials uses the main title poster without TVDB records or a TMDB key", async () => {
  const f = hookFixture({ catalog: async () => new Map() });
  const options = { ...props, titlePoster: "/title.jpg" };
  let data = await settleExplorer(f, options);
  data.setVisibleSeasons([0, 1]);
  data = await settleExplorer(f, options);
  assert.equal(data.artwork.get(0).poster, "/title.jpg");
  assert.equal(data.artwork.get(1).poster, "/title.jpg");
  assert.equal(f.artworkCalls.length, 0);
  assert.equal(f.tmdbCalls.length, 0);
  const SeasonExplorer = seasonExplorerComponent();
  const items = [
    { key: "1", seasonNumber: 1, name: "Season 1", count: 23 },
    { key: "0", seasonNumber: 0, name: "Specials", count: 4 },
  ];
  const html = renderToStaticMarkup(
    React.createElement(SeasonExplorer, {
      data: { ...data, items },
      activeKey: "1",
      onSelect: () => {},
    }),
  );
  assert.equal((html.match(/src="\/title.jpg"/g) ?? []).length, 3);
  f.unmount();
});

test("missing TVDB Specials artwork falls back to the TMDB season-zero images endpoint", async () => {
  const f = hookFixture({
    catalog: async () => new Map(),
    tmdbGet: async () => ({ posters: [{ file_path: "/specials.jpg", iso_639_1: "en" }] }),
  });
  const data = await settleExplorer(f, {
    ...props,
    activeSeason: 0,
    tmdbKey: "test-key",
    tmdbTvId: 42,
    titlePoster: "/title.jpg",
  });
  assert.equal(data.artwork.get(0).poster, "https://image.tmdb.org/t/p/w500/specials.jpg");
  assert.deepEqual(
    f.tmdbCalls.map((call) => call.path),
    ["tv/42/season/0/images"],
  );
  assert.equal(f.calls.length, 0, "artwork must not fetch synopsis or episode lists");
  f.unmount();
});

test("available TVDB posters prevent TMDB lookups, including the default season image", async () => {
  for (const artwork of [
    async () => ({ image: "/preferred.jpg", artwork: [] }),
    async () => ({ artwork: [] }),
  ]) {
    const f = hookFixture({ artwork });
    const data = await settleExplorer(f, {
      ...props,
      tmdbKey: "test-key",
      titlePoster: "/title.jpg",
    });
    assert.ok(data.artwork.get(1).poster);
    assert.notEqual(data.artwork.get(1).poster, "/title.jpg");
    assert.equal(f.tmdbCalls.length, 0);
    f.unmount();
  }
});

test("already-loaded TMDB season posters are reused without new requests", async () => {
  const f = hookFixture({ catalog: async () => new Map() });
  const data = await settleExplorer(f, {
    ...props,
    activeSeason: 0,
    tmdbKey: "test-key",
    tmdbTvId: 42,
    seasonPosters: { 0: "/cached-specials.jpg" },
    titlePoster: "/title.jpg",
  });
  assert.equal(data.artwork.get(0).poster, "/cached-specials.jpg");
  assert.equal(f.tmdbCalls.length, 0);
  f.unmount();
});

test("missing or unavailable TMDB artwork degrades to the title poster and then a placeholder", async () => {
  for (const response of [null, { posters: [] }]) {
    for (const titlePoster of ["/title.jpg", undefined]) {
      const f = hookFixture({ catalog: async () => new Map(), tmdbGet: async () => response });
      const options = { ...props, tmdbKey: "test-key", tmdbTvId: 42, titlePoster };
      const data = await settleExplorer(f, options);
      assert.equal(data.artwork.get(1).poster, titlePoster);
      assert.equal(f.tmdbCalls.length, 1);
      f.render({ ...options, activeSeason: undefined });
      await settleExplorer(f, options);
      assert.equal(f.tmdbCalls.length, 1);
      f.unmount();
    }
  }
});

test("image failures advance both card and panel through TVDB, TMDB, title, and placeholder", async () => {
  const f = hookFixture({
    catalog: async () => new Map([[1, { ...season, image: "/base.jpg" }]]),
    artwork: async () => ({ image: "/preferred.jpg", artwork: [] }),
    tmdbGet: async () => ({ posters: [{ file_path: "/tmdb.jpg", iso_639_1: "en" }] }),
  });
  const options = { ...props, tmdbKey: "test-key", tmdbTvId: 42, titlePoster: "/title.jpg" };
  const SeasonExplorer = seasonExplorerComponent();
  let data = await settleExplorer(f, options);
  for (const expected of [
    "/preferred.jpg",
    "/base.jpg",
    "https://image.tmdb.org/t/p/w500/tmdb.jpg",
    "/title.jpg",
  ]) {
    assert.equal(data.artwork.get(1).poster, expected);
    const html = renderToStaticMarkup(
      React.createElement(SeasonExplorer, {
        data: { ...data, items: [{ key: "1", seasonNumber: 1, name: "Season 1", count: 23 }] },
        activeKey: "1",
        onSelect: () => {},
      }),
    );
    assert.equal(html.split('src="' + expected + '"').length - 1, 2);
    data.onPosterError(1, expected);
    data.onPosterError(1, expected);
    data = await settleExplorer(f, options);
  }
  assert.equal(data.artwork.get(1).poster, undefined);
  assert.equal(f.artworkCalls.length, 1, "image failures must not repeat the TVDB lookup");
  assert.equal(f.tmdbCalls.length, 1, "alternative TMDB candidates reuse cached images");
  f.unmount();
});

test("one lazy IMDb lookup is shared across missing season artwork jobs", async () => {
  const f = hookFixture({
    catalog: async () => new Map(),
    tmdbGet: async (_key, path) =>
      path.startsWith("find/")
        ? { tv_results: [{ id: 42 }] }
        : { posters: [{ file_path: "/season.jpg", iso_639_1: "en" }] },
  });
  const options = { ...props, metaId: "addon:show", imdbId: "tt123", tmdbKey: "test-key" };
  let data = await settleExplorer(f, options);
  data.setVisibleSeasons([0, 1, 2]);
  data = await settleExplorer(f, options);
  assert.ok(data.artwork.get(0).poster);
  assert.ok(data.artwork.get(2).poster);
  assert.equal(f.tmdbCalls.filter((call) => call.path.startsWith("find/")).length, 1);
  assert.equal(f.tmdbCalls.filter((call) => call.path.endsWith("/images")).length, 3);
  f.unmount();
});

test("alternate-order artwork does not borrow TMDB posters without an explicit season mapping", async () => {
  const f = hookFixture({ catalog: async () => new Map() });
  const data = await settleExplorer(f, {
    ...props,
    seasonType: "dvd",
    tmdbKey: "test-key",
    tmdbTvId: 42,
    seasonPosters: { 1: "/aired-season.jpg" },
    titlePoster: "/title.jpg",
  });
  assert.equal(data.artwork.get(1).poster, "/title.jpg");
  assert.equal(f.tmdbCalls.length, 0);
  f.unmount();
});

test("TMDB fallbacks preserve the three-request limit, selection priority, and disposal", async () => {
  const blocked = new Map(Array.from({ length: 8 }, (_, n) => [n, deferred()]));
  const f = hookFixture({
    catalog: async () => new Map(),
    tmdbGet: async (_key, path) => blocked.get(Number(/season\/(\d+)/.exec(path)[1])).promise,
  });
  const options = { ...props, tmdbKey: "test-key", tmdbTvId: 42 };
  let data = await settleExplorer(f, options);
  data.setVisibleSeasons([0, 1, 2, 3, 4, 5, 6]);
  await settleExplorer(f, options);
  const requested = () => f.tmdbCalls.map((call) => Number(/season\/(\d+)/.exec(call.path)[1]));
  assert.deepEqual(requested(), [1, 0, 2]);
  f.render({ ...options, activeSeason: 6 });
  await flush();
  assert.equal(requested().length, 3);
  blocked.get(0).resolve({ posters: [] });
  await flush();
  assert.deepEqual(requested(), [1, 0, 2, 6]);
  f.unmount();
  for (const pending of blocked.values()) pending.resolve({ posters: [] });
  await flush();
  assert.equal(requested().length, 4);
});

test("late TMDB artwork and old image-error callbacks cannot overwrite a replacement scope", async () => {
  const pending = deferred();
  const f = hookFixture({
    catalog: async () => new Map(),
    tmdbGet: async (_key, path) =>
      path.startsWith("tv/42/")
        ? pending.promise
        : { posters: [{ file_path: "/new.jpg", iso_639_1: "en" }] },
  });
  const oldOptions = { ...props, tmdbKey: "test-key", tmdbTvId: 42, titlePoster: "/old-title.jpg" };
  const old = await settleExplorer(f, oldOptions);
  const options = { ...oldOptions, tmdbTvId: 43, titlePoster: "/new-title.jpg" };
  let data = await settleExplorer(f, options);
  const expected = data.artwork.get(1).poster;
  assert.equal(expected, "https://image.tmdb.org/t/p/w500/new.jpg");
  old.onPosterError(1, expected);
  pending.resolve({ posters: [{ file_path: "/old.jpg", iso_639_1: "en" }] });
  data = await settleExplorer(f, options);
  assert.equal(data.artwork.get(1).poster, expected);
  assert.equal(f.tmdbCalls.length, 2);
  f.unmount();
});

test("leaving during an IMDb lookup prevents a stale follow-up season images request", async () => {
  const pending = deferred();
  const f = hookFixture({
    catalog: async () => new Map(),
    tmdbGet: async (_key, path) => {
      assert.match(path, /^find\//, "a disposed lookup must not start an images request");
      return pending.promise;
    },
  });
  await settleExplorer(f, {
    ...props,
    metaId: "addon:show",
    imdbId: "tt123",
    tmdbKey: "test-key",
  });
  assert.equal(f.tmdbCalls.length, 1);
  f.unmount();
  pending.resolve({ tv_results: [{ id: 42 }] });
  await flush();
  assert.equal(f.tmdbCalls.length, 1);
});

async function scrollFixture({ reducedMotion = false } = {}) {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "https://fixture.invalid" });
  const previous = new Map();
  const frames = new Map(),
    intersections = [],
    resizes = [],
    pending = new Map();
  let frameId = 0,
    width = 500,
    parentRenders = 0,
    episodeRenders = 0;
  const counts = new Map(),
    scrollCalls = [];
  const stats = { styles: 0, widths: 0, extents: 0 };
  const requestFrame = (callback) => {
    const id = ++frameId;
    frames.set(id, callback);
    return id;
  };
  const globals = {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
    MutationObserver: dom.window.MutationObserver,
    requestAnimationFrame: requestFrame,
    cancelAnimationFrame: (id) => frames.delete(id),
    getComputedStyle: (element) => {
      if (element.classList.contains("season-explorer-rail")) {
        stats.styles++;
        return { direction: document.documentElement.dir || "ltr" };
      }
      return dom.window.getComputedStyle(element);
    },
    IntersectionObserver: class {
      targets = new Set();
      constructor(callback) {
        this.callback = callback;
        intersections.push(this);
      }
      observe(element) {
        this.targets.add(element);
      }
      unobserve(element) {
        this.targets.delete(element);
      }
      disconnect() {
        this.targets.clear();
      }
    },
    ResizeObserver: class {
      targets = new Set();
      constructor(callback) {
        this.callback = callback;
        resizes.push(this);
      }
      observe(element) {
        this.targets.add(element);
      }
      unobserve(element) {
        this.targets.delete(element);
      }
      disconnect() {
        this.targets.clear();
      }
    },
  };
  for (const [key, value] of Object.entries(globals)) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  Object.defineProperties(dom.window.HTMLElement.prototype, {
    clientWidth: {
      configurable: true,
      get() {
        if (this.classList.contains("season-explorer-rail")) {
          stats.widths++;
          return width;
        }
        return 140;
      },
    },
    scrollWidth: {
      configurable: true,
      get() {
        if (this.classList.contains("season-explorer-rail")) {
          stats.extents++;
          return 40 * 180;
        }
        return 220;
      },
    },
  });
  dom.window.HTMLElement.prototype.scrollBy = function (options) {
    scrollCalls.push(options);
    this.scrollLeft += options.left;
    this.dispatchEvent(new dom.window.Event("scroll"));
  };
  const provider = hookFixture({
    react: React,
    catalog: async (_key, id) =>
      new Map(
        Array.from({ length: 40 }, (_, n) => [
          n,
          { id: id * 100 + n, number: n, name: "Season " + n },
        ]),
      ),
    artwork: (id) => {
      const job = deferred();
      pending.set(id, job);
      return job.promise;
    },
  });
  const visibility = load("src/lib/visibility.ts", { react: React }, globals);
  const coordinates = load("src/lib/horizontal-scroll.ts", {}, globals);
  const SeasonExplorer = seasonExplorerComponent({
    artworkHook: provider.hook.useSeasonExplorerArtwork,
    visibility,
    globals,
    horizontalScroll: coordinates.horizontalScrollState,
    reducedMotion,
    translate: (key, vars) => {
      if (key === "{n} episode" || key === "{n} episodes")
        counts.set(vars.n, (counts.get(vars.n) ?? 0) + 1);
      return key.replace("{n}", String(vars?.n ?? ""));
    },
  });
  const items = Array.from({ length: 40 }, (_, n) => ({
    key: String(n),
    seasonNumber: n,
    name: n === 0 ? "Specials" : "Season " + n,
    nameLanguage: "en",
    count: n + 1,
  }));
  let latest;
  const Episodes = () => {
    episodeRenders++;
    return React.createElement("p", null, "Episode list");
  };
  function Host({ metaId = "tvdb:42", seasonType = "official" }) {
    parentRenders++;
    const [activeKey, select] = React.useState("1");
    const data = provider.hook.useSeasonExplorerView({
      metaId,
      seasonType,
      tvdbKey: "test-key",
      lang: "eng",
      items,
      activeKey,
    });
    latest = data;
    return React.createElement(
      React.Fragment,
      null,
      React.createElement(SeasonExplorer, {
        key: metaId + ":" + seasonType,
        data,
        activeKey,
        onSelect: select,
      }),
      React.createElement(Episodes),
    );
  }
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(document.getElementById("root"));
  const tick = async () => {
    const callbacks = [...frames.values()];
    frames.clear();
    await React.act(async () => {
      callbacks.forEach((callback) => callback(0));
      await flush();
    });
  };
  const settle = async () => {
    await React.act(async () => {
      await flush();
    });
    for (let i = 0; frames.size && i < 8; i++) await tick();
    assert.equal(frames.size, 0, "scroll work must settle");
  };
  const render = async (props = {}) => {
    await React.act(async () => {
      root.render(React.createElement(Host, props));
      await flush();
    });
    await settle();
  };
  const card = (number) => document.querySelector('[data-season-number="' + number + '"]');
  const visible = (number, isIntersecting = true) => {
    const element = card(number);
    for (const observer of intersections)
      if (observer.targets.has(element)) observer.callback([{ target: element, isIntersecting }]);
  };
  await render();
  return {
    dom,
    root,
    frames,
    counts,
    stats,
    resizes,
    intersections,
    pending,
    scrollCalls,
    artworkCalls: provider.artworkCalls,
    card,
    visible,
    tick,
    settle,
    render,
    get rail() {
      return document.querySelector(".season-explorer-rail");
    },
    get parentRenders() {
      return parentRenders;
    },
    get episodeRenders() {
      return episodeRenders;
    },
    get data() {
      return latest;
    },
    resize: (nextWidth) => {
      width = nextWidth;
      const rail = document.querySelector(".season-explorer-rail");
      for (const observer of resizes)
        if (observer.targets.has(rail)) observer.callback([{ target: rail, contentRect: {} }]);
    },
    close: async () => {
      await React.act(async () => root.unmount());
      assert.equal(frames.size, 0, "unmount must cancel queued frames");
      assert.equal(
        intersections.reduce((n, observer) => n + observer.targets.size, 0),
        0,
      );
      assert.equal(
        resizes.reduce((n, observer) => n + observer.targets.size, 0),
        0,
      );
      dom.window.close();
      for (const [key, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
    },
  };
}

test("rail visibility and delayed artwork never render the parent episode page or unchanged cards", async () => {
  const f = await scrollFixture();
  try {
    f.pending.get(4201).resolve({ image: "/first.jpg", artwork: [] });
    await f.settle();
    const parent = f.parentRenders,
      episodes = f.episodeRenders;
    const panel = document.querySelector(".season-explorer-transition");
    f.visible(1);
    f.visible(2);
    f.visible(2);
    assert.deepEqual(f.artworkCalls, [4201], "visibility waits for the next frame");
    await f.settle();
    assert.deepEqual(f.artworkCalls, [4201, 4202]);
    assert.equal(f.resizes.length, 1, "titles share the rail's resize observer");
    const before = new Map(f.counts);
    f.pending.get(4202).resolve({ image: "/second.jpg", artwork: [] });
    await f.settle();
    assert.equal(f.parentRenders, parent);
    assert.equal(f.episodeRenders, episodes);
    for (let n = 1; n <= 40; n++)
      assert.equal(
        f.counts.get(n),
        before.get(n) + (n === 3 ? 1 : 0),
        "only the changed artwork card renders",
      );
    assert.equal(
      document.querySelector(".season-explorer-transition"),
      panel,
      "scrolling keeps the selection animation mounted",
    );
    assert.equal(f.card(1).getAttribute("aria-pressed"), "true");
    assert.match(f.card(2).querySelector("img").src, /second.jpg$/);
    assert.equal(f.rail.querySelectorAll("[data-season-number]").length, 40);
    const offscreenTitle = f.card(39).querySelector(".season-explorer-title");
    assert.equal(f.resizes[0].targets.has(offscreenTitle), false);
    await React.act(async () => f.card(39).focus());
    await f.settle();
    assert.equal(
      f.resizes[0].targets.has(offscreenTitle),
      true,
      "keyboard focus enables offscreen title measurement",
    );
    assert.equal(f.parentRenders, parent, "focus does not activate a season");
    await React.act(async () => f.card(2).click());
    await f.settle();
    assert.equal(f.card(2).getAttribute("aria-pressed"), "true");
    assert.ok(f.parentRenders > parent, "explicit selection still updates the episode page");
  } finally {
    await f.close();
  }
});

test("scroll events share a frame and cached geometry refreshes for resizing and RTL", async () => {
  const f = await scrollFixture();
  try {
    const counts = new Map(f.counts);
    const resetStats = () => {
      f.stats.styles = f.stats.widths = f.stats.extents = 0;
    };
    resetStats();
    for (let n = 1; n <= 10; n++) {
      f.rail.scrollLeft = n * 10;
      f.rail.dispatchEvent(new f.dom.window.Event("scroll"));
    }
    assert.equal(f.frames.size, 1, "one edge update per frame");
    await f.settle();
    assert.deepEqual(
      f.stats,
      { styles: 0, widths: 0, extents: 0 },
      "ordinary scroll reads no layout or computed style",
    );
    assert.deepEqual(f.counts, counts, "edge controls do not rerender cards or the panel");
    assert.ok(document.querySelector(".season-explorer-edge-left"));
    assert.ok(document.querySelector(".season-explorer-edge-right"));
    f.resize(8000);
    await f.settle();
    assert.equal(document.querySelectorAll(".season-explorer-edge").length, 0);
    f.resize(500);
    f.rail.scrollLeft = 0;
    await React.act(async () => {
      document.documentElement.dir = "rtl";
      await flush();
    });
    await f.settle();
    assert.ok(document.querySelector(".season-explorer-edge-left"));
    assert.equal(document.querySelector(".season-explorer-edge-right"), null);
    resetStats();
    f.rail.scrollLeft = -(7200 - 500);
    f.rail.dispatchEvent(new f.dom.window.Event("scroll"));
    await f.settle();
    assert.equal(document.querySelector(".season-explorer-edge-left"), null);
    assert.ok(document.querySelector(".season-explorer-edge-right"));
    assert.deepEqual(f.stats, { styles: 0, widths: 0, extents: 0 });
    // Leave edge, visibility, and title work pending to exercise unmount cleanup.
    f.rail.dispatchEvent(new f.dom.window.Event("scroll"));
    f.visible(2);
    await React.act(async () => f.card(39).focus());
  } finally {
    await f.close();
  }
});

test("title and order replacements cancel queued visibility and discard late artwork", async () => {
  const f = await scrollFixture();
  try {
    const old = f.pending.get(4201);
    f.visible(2);
    await f.render({ metaId: "tvdb:42", seasonType: "dvd" });
    const oldOrder = f.pending.get(4201);
    f.visible(3);
    await f.render({ metaId: "tvdb:43" });
    assert.equal(
      f.artworkCalls.includes(4202),
      false,
      "old visibility cannot start a request after replacement",
    );
    assert.equal(f.artworkCalls.includes(4203), false);
    old.resolve({ image: "/old-title.jpg", artwork: [] });
    oldOrder.resolve({ image: "/old-order.jpg", artwork: [] });
    f.pending.get(4301).resolve({ image: "/new-title.jpg", artwork: [] });
    await f.settle();
    assert.match(f.card(1).querySelector("img").src, /new-title.jpg$/);
    assert.equal(document.querySelector('img[src*="old-"]'), null);
    assert.equal(
      f.intersections.reduce((n, observer) => n + observer.targets.size, 0),
      40,
    );
  } finally {
    await f.close();
  }
});

test("season arrows use the cached viewport width and respect reduced motion", async () => {
  for (const reducedMotion of [false, true]) {
    const f = await scrollFixture({ reducedMotion });
    try {
      const parent = f.parentRenders;
      const before = new Map(f.counts);
      await React.act(async () =>
        document.querySelector(".season-explorer-edge-right button").click(),
      );
      await f.settle();
      assert.equal(f.scrollCalls.length, 1);
      assert.equal(f.scrollCalls[0].left, 400);
      assert.equal(f.scrollCalls[0].behavior, reducedMotion ? "auto" : "smooth");
      assert.equal(f.parentRenders, parent);
      assert.deepEqual(
        f.counts,
        before,
        "paging the rail keeps cards and selected details memoized",
      );
    } finally {
      await f.close();
    }
  }
});
