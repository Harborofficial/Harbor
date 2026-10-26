import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as episodeTextLanguage from "../src/lib/episode-text-language.ts";
import * as episodePlaceholder from "../src/lib/providers/episode-placeholder.ts";
import * as dates from "../src/lib/dates.ts";
import {
  createMediaCache,
  mediaCacheKey,
  episodeCacheTtl,
  metadataCacheTtl,
  MEDIA_TTL,
} from "../src/lib/media-cache.ts";
import * as localizedText from "../src/lib/localized-text.ts";

function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function fixture({
  storage = new Map(),
  blockNames = false,
  seasonName = "シーズン",
  englishName = "English Arc",
  episodeRows,
  episodePage,
} = {}) {
  const calls = [];
  const names = deferred();
  if (!blockNames) names.resolve();
  const seasons = Array.from({ length: 30 }, (_, i) => ({
    id: i + 100,
    number: i + 1,
    name: seasonName,
    type: { type: "official" },
    image: "/base.jpg",
  }));
  seasons.push({ id: 99, number: 0, name: "Bonus Stories", type: { type: "official" } });
  const episodes =
    episodeRows ??
    seasons.map((s) => ({
      id: s.id,
      number: 1,
      seasonNumber: s.number,
      name: "Episode",
    }));
  const localStorage = {
    getItem: (k) => storage.get(k) ?? null,
    setItem: (k, v) => storage.set(k, v),
    removeItem: (k) => storage.delete(k),
  };
  async function safeFetch(url) {
    const path = new URL(url).pathname.replace(/^.*\/v4/, "");
    calls.push(path);
    let data;
    if (path === "/login") data = { token: "test-token" };
    else if (path.includes("/translations/")) {
      await names.promise;
      data = { name: path.includes("/99/") ? "Bonus Stories" : englishName };
    } else if (path.startsWith("/seasons/")) data = { image: "/base.jpg", artwork: [] };
    else if (path.includes("/episodes/")) {
      if (episodePage) return episodePage(new URL(url));
      data = { episodes };
    } else data = { seasons };
    return { ok: true, status: 200, json: async () => ({ data }) };
  }
  function load(file, dependencies) {
    const source = readFileSync(new URL("../" + file, import.meta.url), "utf8");
    const code = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const module = { exports: {} };
    vm.runInNewContext(code, {
      module,
      exports: module.exports,
      localStorage,
      setTimeout,
      clearTimeout,
      require: (name) => {
        assert.ok(name in dependencies, "unmocked dependency " + name);
        return dependencies[name];
      },
    });
    return module.exports;
  }
  const store = {
    async get(key) {
      return storage.has(key) ? JSON.parse(storage.get(key)) : null;
    },
    async put(record) {
      storage.set(record.key, JSON.stringify(record));
      return true;
    },
    async list() {
      return [...storage.entries()]
        .filter(([key]) => key.startsWith("v1:"))
        .map(([, value]) => JSON.parse(value));
    },
    async remove(keys) {
      keys.forEach((key) => storage.delete(key));
    },
    async clear() {
      for (const key of storage.keys()) if (key.startsWith("v1:")) storage.delete(key);
      return true;
    },
  };
  const media = createMediaCache(store);
  const api = {
    MEDIA_TTL,
    episodeCacheTtl,
    metadataCacheTtl,
    mediaCacheGeneration: media.generation,
    onMediaCacheClear() {},
    async loadMedia(namespace, scope, loader, policy) {
      return media.load(await mediaCacheKey(namespace, scope), loader, policy);
    },
    async cachedMedia(...args) {
      return (await api.loadMedia(...args)).value;
    },
    async readMedia(namespace, scope) {
      return media.peek(await mediaCacheKey(namespace, scope));
    },
    async saveMedia(namespace, scope, value, policy, storedAt, generation = media.generation()) {
      return (
        generation === media.generation() &&
        media.save(await mediaCacheKey(namespace, scope), value, policy, storedAt)
      );
    },
  };
  const tvdb = load("src/lib/providers/tvdb.ts", {
    "@/lib/media-cache": api,
    "@/lib/episode-text-language": episodeTextLanguage,
    "@/lib/cache": { lruSet: (m, k, v) => m.set(k, v) },
    "@/lib/memory-profiler": { registerCache: () => {} },
    "@/lib/safe-fetch": { safeFetch },
    "@/lib/config/endpoints": { HARBOR_TVDB_BASE: "https://mock.invalid" },
  });
  const cache = load("src/lib/providers/tvdb-order-cache.ts", {
    "@/lib/media-cache": api,
    "./episode-placeholder": episodePlaceholder,
  });
  const order = load("src/lib/providers/tvdb-order.ts", {
    "./tvdb": tvdb,
    "./tvdb-order-cache": cache,
    "./episode-placeholder": episodePlaceholder,
    "@/lib/media-cache": api,
    "@/lib/episode-text-language": episodeTextLanguage,
  });
  return { ...order, tvdb, calls, names, storage, load };
}

async function promptly(promise) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("episodes blocked by optional metadata")), 100);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

test("cold order renders before translations and upgrades immutable season names", async () => {
  const f = fixture({ blockNames: true });
  try {
    const order = await promptly(f.fetchTvdbOrderBySeriesId("test-key", 1, "aired", "eng"));
    assert.equal(order.seasons[0].name, "Season 1");
    f.names.resolve();
    const enriched = await f.waitForTvdbSeasonNames(order);
    assert.equal(enriched.seasons[0].name, "English Arc");
    assert.notEqual(enriched, order);
    assert.equal(enriched.bySeason, order.bySeason);
    assert.equal(order.seasons[0].name, "Season 1");
    assert.equal(enriched.seasons.find((s) => s.seasonNumber === 0).name, "Bonus Stories");
  } finally {
    f.names.resolve();
  }
});

test("episode ordering makes no unused season artwork requests", async () => {
  const f = fixture();
  const order = await f.fetchTvdbOrderBySeriesId("test-key", 1, "aired", "eng");
  assert.equal(order.seasons[0].posterPath, "https://artworks.thetvdb.com/base.jpg");
  assert.equal(f.calls.filter((p) => /^\/seasons\/\d+\/extended$/.test(p)).length, 0);
});

test("joined views never request per-season names or art", async () => {
  for (const type of ["absolute", "tvdbabsolute"]) {
    const f = fixture();
    const order = await f.fetchTvdbOrderBySeriesId("test-key", 1, type, "eng");
    assert.equal(order.seasons.length, 1);
    assert.equal(order.seasons[0].name, "All Episodes");
    assert.equal(f.calls.filter((p) => p.startsWith("/seasons/")).length, 0);
  }
});

test("adding a direct key refreshes proxy names, including after restarting", async () => {
  const f = fixture();
  await f.fetchTvdbOrderBySeriesId("", 1, "aired", "eng");
  for (const runtime of [f, fixture({ storage: f.storage })]) {
    const order = await runtime.fetchTvdbOrderBySeriesId("test-key", 1, "aired", "eng");
    const enriched = await runtime.waitForTvdbSeasonNames(order);
    assert.equal(enriched.seasons[0].name, "English Arc");
  }
  assert.ok([...f.storage.keys()].every((key) => !key.includes("test-key")));
});

test("concurrent cold loads share one order and name enrichment", async () => {
  const f = fixture({ blockNames: true });
  try {
    const [a, b] = await promptly(
      Promise.all([
        f.fetchTvdbOrderBySeriesId("test-key", 1, "aired", "eng"),
        f.fetchTvdbOrderBySeriesId("test-key", 1, "aired", "eng"),
      ]),
    );
    assert.equal(a, b);
    assert.equal(f.waitForTvdbSeasonNames(a), f.waitForTvdbSeasonNames(b));
  } finally {
    f.names.resolve();
  }
});

test("core and English catalogs overlap and warm availability uses durable metadata", async () => {
  const gate = deferred();
  const f = fixture({
    episodePage: async () => {
      await gate.promise;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: { episodes: [{ id: 1, number: 1, seasonNumber: 1, name: "Real title" }] },
        }),
      };
    },
  });
  const pending = f.fetchTvdbOrderBySeriesId("", 1, "aired", "eng");
  try {
    await promptly(
      (async () => {
        while (!f.calls.some((path) => path.includes("/episodes/default/eng")))
          await new Promise((resolve) => setTimeout(resolve, 0));
      })(),
    );
    assert.ok(f.calls.some((path) => path.endsWith("/episodes/default")));
  } finally {
    gate.resolve();
  }
  assert.ok(await pending);
  const restarted = fixture({ storage: f.storage });
  assert.equal(await restarted.tvdb.tvdbOrderTypeHasEpisodes("", 1, "aired"), true);
  assert.equal(restarted.calls.length, 0);
});

test("a generic English translation never replaces a real TVDB season name", async () => {
  const f = fixture({ seasonName: "East Blue", englishName: "Season 1" });
  const order = await f.fetchTvdbOrderBySeriesId("test-key", 1, "aired", "eng");
  const named = await f.waitForTvdbSeasonNames(order);
  assert.equal(named.seasons[0].name, "East Blue");
  assert.equal(named.seasons[0].isGenericName, false);
});

test("anime proxy uses the English season names from series extended", async () => {
  const f = fixture({ seasonName: "East Blue" });
  const order = await f.fetchTvdbOrderBySeriesId("", 1, "aired", "eng", true);
  assert.equal(order.seasons[0].name, "East Blue");
  const named = await f.waitForTvdbSeasonNames(order);
  assert.equal(named.seasons[0].name, "East Blue");
  assert.equal(f.calls.filter((p) => p.includes("/translations/")).length, 0);
});

test("regular series without a key do not request proxy season names", async () => {
  const f = fixture();
  const order = await f.fetchTvdbOrderBySeriesId("", 1, "aired", "eng");
  const named = await f.waitForTvdbSeasonNames(order);
  assert.equal(named.seasons[0].name, "Season 1");
  assert.equal(f.calls.filter((p) => p.includes("/translations/")).length, 0);
});

test("a regular proxy order cannot suppress anime season-name enrichment", async () => {
  const f = fixture({ blockNames: true });
  try {
    const regular = await f.fetchTvdbOrderBySeriesId("", 1, "aired", "eng", false);
    assert.equal(regular.seasonNamesResolved, true);
    const anime = await f.fetchTvdbOrderBySeriesId("", 1, "aired", "eng", true);
    assert.equal(anime.seasonNamesResolved, false);
    f.names.resolve();
    assert.equal((await f.waitForTvdbSeasonNames(anime)).seasonNamesResolved, true);
  } finally {
    f.names.resolve();
  }
});

test("custom specials titles survive both proxy and English translation paths", async () => {
  for (const key of ["", "test-key"]) {
    const f = fixture();
    const names = await f.tvdb.tvdbSeasonNames(key, 1, "official");
    assert.equal(names.get(0), "Bonus Stories");
  }
});

test("translation work is bounded for large series", async () => {
  const f = fixture({ blockNames: true });
  try {
    const order = await promptly(f.fetchTvdbOrderBySeriesId("test-key", 1, "aired", "eng"));
    await promptly(
      (async () => {
        while (f.calls.filter((p) => p.includes("/translations/")).length < 4)
          await new Promise((r) => setTimeout(r, 0));
      })(),
    );
    assert.equal(f.calls.filter((p) => p.includes("/translations/")).length, 4);
    f.names.resolve();
    await f.waitForTvdbSeasonNames(order);
    assert.equal(f.calls.filter((p) => p.includes("/translations/")).length, 31);
  } finally {
    f.names.resolve();
  }
});

test("unfinished persisted name enrichment resumes after restarting", async () => {
  const first = fixture({ blockNames: true });
  try {
    await promptly(first.fetchTvdbOrderBySeriesId("test-key", 1, "aired", "eng"));
    const restarted = fixture({ storage: first.storage });
    const order = await restarted.fetchTvdbOrderBySeriesId("test-key", 1, "aired", "eng");
    assert.equal(order.seasons[0].name, "Season 1");
    const named = await restarted.waitForTvdbSeasonNames(order);
    assert.equal(named.seasons[0].name, "English Arc");
    assert.equal(restarted.calls.filter((p) => p.includes("/episodes/")).length, 0);
  } finally {
    first.names.resolve();
  }
});

function panelFixture(f, availability, seasonType = "aired") {
  const effects = [],
    updates = [];
  let stateIndex = 0;
  const panel = f.load("src/views/detail/anime-episodes/use-anime-tvdb-panel.ts", {
    react: {
      useState: (initial) => {
        const index = stateIndex++;
        return [index === 0 ? 1 : initial, (value) => updates.push({ index, value })];
      },
      useEffect: (effect) => effects.push(effect),
      useMemo: (compute) => compute(),
      useCallback: (callback) => callback,
    },
    "@/lib/i18n": { useT: () => (key) => key },
    "@/lib/providers/anime-mapping": {},
    "@/lib/providers/anime-detail": {},
    "@/lib/providers/anime-episode-build": {
      isForeignScriptTitle: episodeTextLanguage.isForeignScriptTitle,
    },
    "@/lib/dates": dates,
    "@/lib/providers/tvdb": {
      ...f.tvdb,
      tvdbSeasonTypes: () => availability.promise,
      tvdbOrderTypeHasEpisodes: async () => true,
    },
    "@/lib/providers/tmdb/tmdb-client": { tmdbLanguageIso: () => "en" },
    "@/lib/localized-text": {},
    "@/lib/providers/harbor-imdb": {},
    "@/lib/providers/tvdb-order": f,
    "@/lib/streams/anime-identity": {},
    "./anime-slot-match": {},
  });
  panel.useAnimeTvdbPanel(1, null, [], seasonType, "test-key", true);
  return { updates, run: () => effects[2]() };
}

test("anime selected order renders before alternative-order discovery finishes", async () => {
  const f = fixture({ blockNames: true }),
    availability = deferred();
  const panel = panelFixture(f, availability);
  const cleanup = panel.run();
  try {
    await promptly(
      (async () => {
        for (let attempt = 0; attempt < 80; attempt++) {
          if (panel.updates.some((u) => u.index === 1 && u.value)) return;
          await new Promise((r) => setTimeout(r, 1));
        }
        throw new Error("selected order did not render");
      })(),
    );
    const initial = panel.updates.find((u) => u.index === 1).value;
    assert.equal(initial.seasons[0].name, "Season 1");
    f.names.resolve();
    await f.waitForTvdbSeasonNames(initial);
    await new Promise((r) => setImmediate(r));
    assert.equal(
      panel.updates.filter((u) => u.index === 1).at(-1).value.seasons[0].name,
      "English Arc",
    );
  } finally {
    cleanup();
    availability.resolve([{ value: "aired", label: "Aired Order" }]);
    f.names.resolve();
  }
});

test("leaving an anime page prevents late names and tabs from updating it", async () => {
  const f = fixture({ blockNames: true }),
    availability = deferred();
  const panel = panelFixture(f, availability),
    cleanup = panel.run();
  cleanup();
  f.names.resolve();
  availability.resolve([{ value: "aired", label: "Aired Order" }]);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(panel.updates.length, 0);
});

test("season pills respect generic metadata names even with a different UI language", () => {
  const { seasonPill } = fixture().load("src/lib/season-name.ts", {});
  const t = (_key, { n }) => "Season " + n;
  for (const name of ["Season 1", "Sezon 1", "Temporada 1", "シーズン1", "第 1 季"])
    assert.equal(seasonPill({ name, seasonNumber: 1 }, t), null);
  assert.equal(
    seasonPill({ name: "Unknown default", seasonNumber: 1, isGenericName: true }, t),
    null,
  );
  assert.equal(
    seasonPill({ name: "East Blue", seasonNumber: 1, isGenericName: false }, t),
    "Season 1",
  );
  assert.equal(seasonPill({ name: "All Episodes", seasonNumber: 1 }, t), null);
  assert.equal(seasonPill({ name: "Bonus Stories", seasonNumber: 0 }, t), null);
});

test("reading a completed persisted order preserves its expiry", async () => {
  const f = fixture();
  const order = await f.fetchTvdbOrderBySeriesId("test-key", 1, "aired", "eng");
  await f.waitForTvdbSeasonNames(order);
  const [key, value] = [...f.storage.entries()].find(([k]) => k.startsWith("v1:tvdb-order:"));
  const saved = JSON.parse(value);
  saved.storedAt = Date.now() - 10000;
  f.storage.set(key, JSON.stringify(saved));
  const restarted = fixture({ storage: f.storage });
  await restarted.fetchTvdbOrderBySeriesId("test-key", 1, "aired", "eng");
  assert.equal(JSON.parse(f.storage.get(key)).storedAt, saved.storedAt);
});

function specialPanelRows(f, ordering) {
  const states = [1, ordering, [], "aired", "0", true, "has", null];
  let index = 0;
  const { useAnimeTvdbPanel } = f.load("src/views/detail/anime-episodes/use-anime-tvdb-panel.ts", {
    react: {
      useState: () => [states[index++], () => {}],
      useEffect: () => {},
      useMemo: (compute) => compute(),
      useCallback: (callback) => callback,
    },
    "@/lib/i18n": { useT: () => (key) => key },
    "@/lib/providers/anime-mapping": {},
    "@/lib/providers/anime-detail": {},
    "@/lib/providers/anime-episode-build": {
      isForeignScriptTitle: episodeTextLanguage.isForeignScriptTitle,
    },
    "@/lib/dates": dates,
    "@/lib/providers/tvdb": f.tvdb,
    "@/lib/providers/tmdb/tmdb-client": { tmdbLanguageIso: () => "en" },
    "@/lib/localized-text": localizedText,
    "@/lib/providers/harbor-imdb": {},
    "@/lib/providers/tvdb-order": f,
    "@/lib/streams/anime-identity": {},
    "./anime-slot-match": f.load("src/views/detail/anime-episodes/anime-slot-match.ts", {}),
  });
  const { panel } = useAnimeTvdbPanel(1, null, [], "aired", "", true);
  assert.ok(panel);
  return panel.visibleEpisodes;
}

test("a failed middle TVDB page is never published or persisted as a complete catalog", async () => {
  const f = fixture({
    episodePage(url) {
      const page = Number(url.searchParams.get("page"));
      return page === 0
        ? {
            ok: true,
            status: 200,
            json: async () => ({
              data: {
                episodes: Array.from({ length: 500 }, (_, i) => ({
                  id: i + 1,
                  number: i + 1,
                  seasonNumber: 1,
                  name: "Title",
                })),
              },
            }),
          }
        : { ok: false, status: 503 };
    },
  });
  assert.equal(await f.fetchTvdbOrderBySeriesId("", 1, "aired", "eng"), null);
  assert.equal(
    [...f.storage.keys()].filter((key) => /^v1:tvdb-(?:order|episodes):/.test(key)).length,
    0,
  );
});

test("reaching the TVDB pagination safety cap fails instead of caching a truncated catalog", async () => {
  const f = fixture({
    episodePage() {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            episodes: Array.from({ length: 500 }, (_, i) => ({
              id: i + 1,
              number: i + 1,
              seasonNumber: 1,
              name: "Title",
            })),
          },
        }),
      };
    },
  });
  await assert.rejects(f.tvdb.tvdbEpisodesByType("", 1, "default"), /unavailable/);
  assert.equal(
    [...f.storage.keys()].filter((key) => key.startsWith("v1:tvdb-episodes:")).length,
    0,
  );
});

test("fresh and cached proxy orders do not give missing special stills another special's image", async () => {
  const episodeRows = [
    { id: 101, seasonNumber: 1, number: 1, absoluteNumber: 1, name: "Pilot", image: "/pilot.jpg" },
    {
      id: 1,
      seasonNumber: 0,
      number: 1,
      absoluteNumber: 0,
      name: "First special",
      image: "/first.jpg",
    },
    {
      id: 2,
      seasonNumber: 0,
      number: 2,
      absoluteNumber: 0,
      name: "Second special",
      image: "/second.jpg",
    },
    { id: 11, seasonNumber: 0, number: 11, absoluteNumber: 0, name: "No still", image: null },
    {
      id: 26,
      seasonNumber: 0,
      number: 26,
      absoluteNumber: 0,
      name: "Last special",
      image: "/last.jpg",
    },
    ...[-1, 1.5, NaN, Infinity].map((absoluteNumber, i) => ({
      id: 200 + i,
      seasonNumber: 1,
      number: 2 + i,
      absoluteNumber,
      name: "Invalid absolute",
      image: "/invalid.jpg",
    })),
  ];
  const fresh = fixture({ episodeRows });
  const ordering = await fresh.fetchTvdbOrderBySeriesId("", 1, "aired", "eng");
  await fresh.waitForTvdbSeasonNames(ordering);
  assert.deepEqual(Array.from(ordering.imageByAbs.keys()), [1]);
  assert.equal(ordering.absByEpId.get(11), 0, "playback mappings remain unchanged");

  const [key, value] = [...fresh.storage.entries()].find(([k]) => k.startsWith("v1:tvdb-order:"));
  const saved = JSON.parse(value);
  saved.value.imageByAbs.push(
    [0, "https://wrong/last-special.jpg"],
    [-1, "https://wrong/negative.jpg"],
    [1.5, "https://wrong/fraction.jpg"],
  );
  saved.storedAt = Date.now() - 10000;
  fresh.storage.set(key, JSON.stringify(saved));
  const restarted = fixture({ storage: fresh.storage, episodeRows });
  const cached = await restarted.fetchTvdbOrderBySeriesId("", 1, "aired", "eng");
  assert.equal(restarted.calls.filter((p) => p.includes("/episodes/")).length, 0);
  assert.equal(
    JSON.parse(fresh.storage.get(key)).storedAt,
    saved.storedAt,
    "reading keeps the original cache expiry",
  );

  for (const [runtime, order] of [
    [fresh, ordering],
    [restarted, cached],
  ]) {
    assert.deepEqual(Array.from(order.imageByAbs.keys()), [1]);
    assert.equal(order.absByEpId.get(11), 0);
    const rows = specialPanelRows(runtime, order);
    assert.deepEqual(
      Array.from(rows, (ep) => ep.number),
      [1, 2, 11, 26],
    );
    assert.deepEqual(
      Array.from(rows, (ep) => ep.thumbnail),
      [
        "https://artworks.thetvdb.com/first.jpg",
        "https://artworks.thetvdb.com/second.jpg",
        null,
        "https://artworks.thetvdb.com/last.jpg",
      ],
    );
    assert.equal(rows[2].imdbSeason, 0);
    assert.equal(rows[2].imdbEpisode, 11);
    assert.equal(rows[2].tvdbEpisodeId, 11);
  }
});

test("anime falls back to an available order if the requested order is empty", async () => {
  const f = fixture();
  const loadOrder = f.fetchTvdbOrderBySeriesId;
  f.fetchTvdbOrderBySeriesId = (key, id, type, lang) =>
    type === "dvd" ? Promise.resolve(null) : loadOrder(key, id, type, lang);
  const availability = deferred();
  availability.resolve([{ value: "aired", label: "Aired Order" }]);
  const panel = panelFixture(f, availability, "dvd");
  const cleanup = panel.run();
  try {
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(panel.updates.find((u) => u.index === 3).value, "aired");
    assert.ok(panel.updates.find((u) => u.index === 1).value.bySeason.size > 0);
  } finally {
    cleanup();
  }
});

test("anime retries a requested order confirmed available after a transient failure", async () => {
  const f = fixture(),
    loadOrder = f.fetchTvdbOrderBySeriesId;
  let attempts = 0;
  f.fetchTvdbOrderBySeriesId = (...args) =>
    ++attempts === 1 ? Promise.resolve(null) : loadOrder(...args);
  const availability = deferred();
  availability.resolve([{ value: "aired", label: "Aired Order" }]);
  const panel = panelFixture(f, availability),
    cleanup = panel.run();
  try {
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(attempts, 2);
    assert.ok(panel.updates.some((u) => u.index === 1 && u.value));
  } finally {
    cleanup();
  }
});
