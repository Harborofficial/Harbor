import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

function load(file, dependencies, globals = {}) {
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
    setTimeout,
    clearTimeout,
    require(name) {
      assert.ok(name in dependencies, `Unexpected import ${name}`);
      return dependencies[name];
    },
    ...globals,
  });
  return module.exports;
}

function fixture({ only = true, addons = [], results = {}, order = [] } = {}) {
  addons = addons.map((a) => ({ ...a, manifest: { resources: ["meta"], ...a.manifest } }));
  const requests = [];
  const policy = { addonOnlyMetadata: () => only };
  const storage = {
    getItem: () => JSON.stringify({ addonOnlyMetadata: only, metadataAddonOrder: order }),
  };
  const cinemeta = load(
    "cinemeta.ts",
    {
      "./metadata-policy": policy,
      "./addon-configuration-key": { persistableAddonOrigin: () => undefined },
      "@/lib/cinemeta-cache": { withMetaCache: async (_type, _id, work) => (await work()).value },
      "@/lib/addon-configuration-key": { addonConfigurationKey: () => undefined },
      "@/lib/safe-fetch": {
        safeFetch: async () => {
          throw new Error("Unexpected built-in request");
        },
      },
    },
    {
      localStorage: storage,
      fetch: async () => {
        throw new Error("Unexpected built-in request");
      },
    },
  );
  const metadata = load(
    "metadata-addons.ts",
    {
      "./addon-configuration-key": { addonConfigurationKey: () => undefined },
      "./addons-store/reorder": {
        applyOrderToItems: (items) => [...items],
        loadDisplayOrder: () => [],
      },
    },
    { localStorage: storage },
  );
  const resolver = load(
    "meta-resource.ts",
    {
      "./metadata-policy": policy,
      "./cinemeta": cinemeta,
      "./metadata-addons": metadata,
      "@/lib/addon-url": {
        addonBaseUrl: (url) => url.replace(/\/manifest\.json\/?$/i, "").replace(/\/+$/, ""),
        addonResourceUrl: (base, path) => `${base.replace(/\/$/, "")}/${path.replace(/^\/+/, "")}`,
      },
      "./safe-fetch": {
        safeFetch: async (url) => {
          requests.push(url);
          return { ok: true, json: async () => ({ meta: results[url] }) };
        },
      },
      "./addons": {
        userAddons: async () => [],
        gatherCatalogAddons: async () => addons,
        addonAccepts: () => true,
      },
      "./addon-store": { filterEnabled: (items) => items, loadInstalled: () => addons },
      "./auth": { readActiveStremioAuthKey: () => null },
      "./cache": { lruSet: (cache, key, value) => cache.set(key, value) },
    },
    { localStorage: storage },
  );
  return { ...cinemeta, ...resolver, ...metadata, requests };
}

test("addon-only mode blocks forced Cinemeta and built-in catalogs", async () => {
  const f = fixture();
  assert.equal(await f.meta("movie", "tt123", true), null);
  assert.equal((await f.topMovies()).length, 0);
  assert.equal(await f.resolveMeta(null, "movie", "tt123"), null);
  assert.equal(f.requests.length, 0);
});

test("addon-only mode keeps addon order and combines addon episodes without built-in fallback", async () => {
  const addons = ["first", "second"].map((id) => ({
    manifest: { id, name: id },
    transportUrl: `https://${id}.test/manifest.json`,
  }));
  const f = fixture({
    addons,
    results: {
      "https://first.test/meta/series/tt123.json": {
        id: "tt123",
        type: "series",
        name: "Addon title",
        poster: "addon.jpg",
      },
      "https://second.test/meta/series/tt123.json": {
        id: "tt123",
        type: "series",
        name: "Other title",
        videos: [{ id: "tt123:1:1", season: 1, episode: 1 }],
      },
    },
  });
  const result = await f.resolveMeta(null, "series", "tt123", { requireVideos: true });
  assert.equal(result.name, "Addon title");
  assert.equal(result.videos.length, 1);
  assert.equal(result.addonOrigin.id, "first");
});

test("explicitly installed Cinemeta remains an addon choice", async () => {
  const f = fixture({
    addons: [
      {
        manifest: { id: "cinemeta", name: "Cinemeta" },
        transportUrl: "https://addon.test/manifest.json",
      },
    ],
    results: {
      "https://addon.test/meta/movie/tt123.json": {
        id: "tt123",
        type: "movie",
        name: "User addon",
      },
    },
  });
  assert.equal((await f.resolveMeta(null, "movie", "tt123")).name, "User addon");
});

test("missing addon responses never trigger built-in fallback", async () => {
  const f = fixture({
    addons: [{ manifest: { id: "empty" }, transportUrl: "https://empty.test/manifest.json" }],
  });
  assert.equal(await f.resolveMeta(null, "movie", "tt123"), null);
  assert.equal(f.requests.length, 1);
});

test("metadata policy defaults off and follows the active settings mirror", () => {
  let raw = null;
  const policy = load("metadata-policy.ts", {}, { localStorage: { getItem: () => raw } });
  assert.equal(policy.addonOnlyMetadata(), false);
  raw = JSON.stringify({ addonOnlyMetadata: true });
  assert.equal(policy.addonOnlyMetadata(), true);
  raw = JSON.stringify({ addonOnlyMetadata: false });
  assert.equal(policy.addonOnlyMetadata(), false);
  raw = "broken";
  assert.equal(policy.addonOnlyMetadata(), false);
});

test("addon-only mode allows a configured TMDB key but blocks an empty one", async () => {
  const unexpected = () => {
    throw new Error("Built-in metadata must not be read without a key");
  };
  const client = load("providers/tmdb/tmdb-client.ts", {
    "@/lib/metadata-policy": { addonOnlyMetadata: () => true },
    "@/lib/safe-fetch": { safeFetch: unexpected },
    "@/lib/request-scheduler": { createRequestScheduler: () => ({ schedule: unexpected }) },
    "./tmdb-catalog-cache": {
      createCatalogCache: () => ({ get: unexpected }),
      isCatalogPath: unexpected,
    },
    "@/lib/cache": { lruSet: unexpected },
    "@/lib/media-cache": { cachedMedia: unexpected },
  });
  assert.equal(await client.get("", "movie/123"), null);
});

test("search distinguishes addon-only mode from an actual TMDB outage with a saved key", async () => {
  let only = true;
  let requests = 0;
  let response = null;
  const search = load("search.ts", {
    "@/lib/metadata-policy": { addonOnlyMetadata: () => only, useTmdbTopMatch: () => true },
    "./providers/anime-catalog-client": {},
    "@/lib/providers/tmdb/tmdb-client": {
      effectiveTmdbLanguage: () => "en",
      get: async () => {
        requests++;
        return response;
      },
    },
    "@/lib/providers/tmdb/tmdb-meta-mappers": {
      movieMeta: (row) => ({ id: `tmdb:movie:${row.id}`, type: "movie", name: row.title }),
    },
    "@/lib/feed/tags": { MOVIE_GENRES: {}, TV_GENRES: {} },
    "@/lib/iptv/store": {},
    "@/lib/iptv/rtl": {},
    "@/lib/settings/load": { loadStoredSettings: () => ({ translateTitles: false }) },
    "@/lib/safe-fetch": {},
    "@/lib/anilist/browse": {},
  });
  const disabled = await search.searchAll("saved-key", "Batman");
  assert.equal(requests, 0);
  assert.equal(disabled.tmdbUnavailable, undefined);
  only = false;
  const failed = await search.searchAll("saved-key", "Batman");
  assert.equal(requests, 1);
  assert.equal(failed.tmdbUnavailable, true);
  only = true;
  const missingTop = await search.searchAll("saved-key", "Batman", { topMatchOnly: true });
  assert.equal(missingTop.tmdbUnavailable, false);
  response = {
    results: [
      { id: 1, media_type: "movie", title: "Batman", poster_path: "/poster", popularity: 10 },
    ],
  };
  const topOnly = await search.searchAll("saved-key", "Batman", { topMatchOnly: true });
  assert.equal(topOnly.topMatch.meta.name, "Batman");
  assert.equal(topOnly.movies.length, 0);
  assert.equal(topOnly.series.length, 0);
  assert.equal(topOnly.people.length, 0);
});

const completeMeta = (name) => ({
  id: "tt123",
  type: "movie",
  name,
  description: "Story",
  poster: "poster",
  background: "backdrop",
  logo: "logo",
});
const metaAddon = (id, resources = ["meta"]) => ({
  manifest: { id, name: id, resources },
  transportUrl: `https://${id}.test/manifest.json`,
});

test("metadata order ignores non-meta addons and recognizes custom ID namespaces", () => {
  const f = fixture();
  const items = [
    metaAddon("stream", ["stream"]),
    metaAddon("custom", [{ name: "meta", types: ["anime"], idPrefixes: ["custom:"] }]),
    metaAddon("first"),
  ];
  assert.deepEqual(
    Array.from(f.orderedMetadataAddons(items, ["first"]), (a) => a.manifest.id),
    ["first", "custom"],
  );
});

test("metadata fallback is sequential and stops once the required fields are present", async () => {
  const f = fixture({
    addons: [metaAddon("first"), metaAddon("second"), metaAddon("third")],
    order: ["second", "first", "third"],
    results: {
      "https://second.test/meta/movie/tt123.json": completeMeta("Priority title"),
      "https://first.test/meta/movie/tt123.json": completeMeta("Lower title"),
    },
  });
  assert.equal((await f.resolveMeta(null, "movie", "tt123")).name, "Priority title");
  assert.deepEqual(f.requests, ["https://second.test/meta/movie/tt123.json"]);
});

test("missing fields are filled by lower priorities without replacing preferred metadata", async () => {
  const f = fixture({
    addons: [metaAddon("first"), metaAddon("second"), metaAddon("third")],
    results: {
      "https://second.test/meta/movie/tt123.json": {
        id: "tt123",
        type: "movie",
        name: "Preferred",
        poster: "preferred-poster",
      },
      "https://third.test/meta/movie/tt123.json": completeMeta("Lower"),
    },
  });
  const result = await f.resolveMeta(null, "movie", "tt123");
  assert.equal(result.name, "Preferred");
  assert.equal(result.poster, "preferred-poster");
  assert.equal(result.description, "Story");
  assert.equal(result.addonOrigin.id, "second");
  assert.deepEqual(f.requests, [
    "https://first.test/meta/movie/tt123.json",
    "https://second.test/meta/movie/tt123.json",
    "https://third.test/meta/movie/tt123.json",
  ]);
});

test("addon Top Match follows metadata priority and matches the configured instance", () => {
  const key = (url) => url.replace(/\/manifest\.json$/, "");
  const metadata = load("metadata-addons.ts", {
    "./addon-configuration-key": { addonConfigurationKey: key },
    "./addons-store/reorder": {
      applyOrderToItems: (items) => [...items],
      loadDisplayOrder: () => [],
    },
  });
  const { addonsBeforeTmdb, addonTopMatch, prioritizedTopMatch } = load("search-top-match.ts", {
    "./addon-configuration-key": { addonConfigurationKey: key },
    "./metadata-addons": metadata,
    "./search-query": { normalizeSearchQuery: (q) => q.trim().toLowerCase() },
  });
  const first = metaAddon("first"),
    second = metaAddon("second");
  second.manifest.id = first.manifest.id;
  const metas = [
    { ...completeMeta("Batman Begins"), addonOrigin: { id: "first", base: "https://first.test" } },
    { ...completeMeta("Batman"), addonOrigin: { id: "first", base: "https://second.test" } },
  ];
  assert.equal(addonTopMatch([first, second], metas, "Batman", []).meta.name, "Batman Begins");
  assert.equal(
    addonTopMatch([first, second], metas, "Batman", [key(second.transportUrl)]).meta.name,
    "Batman",
  );
  assert.equal(addonTopMatch([first, second], metas.slice(1), "Batman", []).meta.name, "Batman");
  const firstKey = key(first.transportUrl);
  const secondKey = key(second.transportUrl);
  assert.deepEqual(
    addonsBeforeTmdb([first, second], [`addon:${firstKey}`, "tmdb", `addon:${secondKey}`]).map(
      (addon) => addon.manifest.id,
    ),
    ["first"],
  );
  assert.equal(addonsBeforeTmdb([first, second], ["tmdb", `addon:${firstKey}`]).length, 0);
  const earlyBoth = addonsBeforeTmdb(
    [first, second],
    [`addon:${firstKey}`, `addon:${secondKey}`, "tmdb"],
  );
  assert.equal(earlyBoth.length, 2);
  assert.equal(earlyBoth[0], first);
  assert.equal(earlyBoth[1], second);

  const tmdbTop = { kind: "movie", meta: { id: "tmdb:movie:1", type: "movie", name: "Batman" } };
  const addonTop = { kind: "series", meta: { id: "tt1", type: "series", name: "Batman" } };
  for (const chain of [
    [],
    ["__default_search_addons__", "tmdb"],
    ["tmdb"],
    [`addon:${key(first.transportUrl)}`],
  ]) {
    for (const tmdbEnabled of [true, false]) {
      assert.equal(
        prioritizedTopMatch({ chain, tmdbTop: null, addonTop, earlyAddonTop: null, tmdbEnabled }),
        addonTop,
      );
    }
    assert.equal(
      prioritizedTopMatch({
        chain,
        tmdbTop,
        addonTop,
        earlyAddonTop: addonTop,
        tmdbEnabled: false,
      }),
      addonTop,
    );
  }
  assert.equal(
    prioritizedTopMatch({
      chain: ["tmdb", `addon:${key(first.transportUrl)}`],
      tmdbTop,
      addonTop,
      earlyAddonTop: null,
      tmdbEnabled: true,
    }),
    tmdbTop,
  );
  assert.equal(
    prioritizedTopMatch({
      chain: [`addon:${key(first.transportUrl)}`, "tmdb"],
      tmdbTop,
      addonTop,
      earlyAddonTop: addonTop,
      tmdbEnabled: true,
    }),
    tmdbTop,
  );
  assert.equal(
    prioritizedTopMatch({
      chain: [`addon:${key(first.transportUrl)}`],
      tmdbTop,
      addonTop,
      earlyAddonTop: null,
      tmdbEnabled: true,
    }),
    tmdbTop,
  );
  assert.equal(
    prioritizedTopMatch({
      chain: [],
      tmdbTop,
      addonTop,
      earlyAddonTop: null,
      tmdbEnabled: false,
    }),
    addonTop,
  );
  assert.equal(
    prioritizedTopMatch({
      chain: ["__default_search_addons__", "tmdb"],
      tmdbTop,
      addonTop,
      earlyAddonTop: addonTop,
      tmdbEnabled: true,
    }),
    tmdbTop,
  );
  assert.equal(
    prioritizedTopMatch({
      chain: ["__default_search_addons__", "tmdb"],
      tmdbTop,
      addonTop,
      earlyAddonTop: null,
      tmdbEnabled: true,
    }),
    tmdbTop,
  );
});

test("a configured TMDB key reaches the network in addon-only mode", async () => {
  let requests = 0;
  const client = load(
    "providers/tmdb/tmdb-client.ts",
    {
      "@/lib/metadata-policy": { addonOnlyMetadata: () => true },
      "@/lib/safe-fetch": {
        safeFetch: async () => {
          requests++;
          return new Response(JSON.stringify({ results: [] }));
        },
      },
      "@/lib/request-scheduler": {
        createRequestScheduler: () => ({ schedule: (_key, work) => work() }),
      },
      "./tmdb-catalog-cache": { createCatalogCache: () => ({}), isCatalogPath: () => false },
      "@/lib/cache": { lruSet() {} },
      "@/lib/media-cache": { cachedMedia: (_kind, _key, work) => work() },
    },
    { URL, Response, TextDecoder },
  );
  assert.equal(await client.get("", "movie/123"), null);
  assert.equal(requests, 0);
  assert.equal((await client.get("saved-key", "movie/123")).results.length, 0);
  assert.equal(requests, 1);
});

test("resetting metadata priority restores the original addon-list order", async () => {
  const f = fixture({
    addons: [metaAddon("first"), metaAddon("second")],
    order: ["second", "first"],
  });
  assert.deepEqual(
    Array.from(await f.metadataAddons(null), (addon) => addon.manifest.id),
    ["second", "first"],
  );
  assert.deepEqual(
    Array.from(await f.metadataAddons(null, []), (addon) => addon.manifest.id),
    ["first", "second"],
  );
});
