import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { metadataCacheTtl } from "../src/lib/media-cache.ts";
import { memoryMediaCache } from "./helpers/media-cache.mjs";
import { createRequestScheduler } from "../src/lib/request-scheduler.ts";

const tick = () => new Promise((resolve) => setImmediate(resolve));
function fixture({ placeholder = false, upcoming = false, absent = false } = {}) {
  let now = Date.now();
  let offline = false;
  let fetches = 0;
  let rawGate;
  const requests = [];
  let videos = [{ id: "kitsu:12:1", season: 1, episode: 1, title: "Old", released: "2020-01-01" }];
  if (placeholder)
    videos[0] = { ...videos[0], title: "TBA", released: new Date(now - 1000).toISOString() };
  if (upcoming) videos[0] = { ...videos[0], released: new Date(now + 10 * 60_000).toISOString() };
  const store = memoryMediaCache({ now: () => now, memoryBytes: 0 });
  const media = {
    ...store,
    episodeCacheTtl: (rows, at = now) => store.episodeCacheTtl(rows, at),
    metadataCacheTtl: (value, at = now) => metadataCacheTtl(value, at),
  };
  const FakeDate = class extends Date {
    static now() {
      return now;
    }
  };
  const load = (file, dependencies) => {
    const module = { exports: {} };
    const code = ts.transpileModule(
      readFileSync(new URL(`../src/lib/${file}.ts`, import.meta.url), "utf8"),
      {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      },
    ).outputText;
    vm.runInNewContext(code, {
      module,
      exports: module.exports,
      Date: FakeDate,
      AbortSignal,
      setTimeout,
      clearTimeout,
      URLSearchParams,
      require: (name) => {
        assert.ok(name in dependencies, `Missing dependency: ${name}`);
        return dependencies[name];
      },
    });
    return module.exports;
  };
  const safeFetch = async (url) => {
    requests.push(url);
    if (offline) throw new Error("offline");
    if (url.includes("/meta/")) {
      fetches++;
      return {
        ok: !absent,
        status: absent ? 404 : 200,
        json: async () =>
          absent ? {} : { meta: { id: "kitsu:12", imdb_id: "tt12", name: "Example", videos } },
      };
    }
    const episodes = url.includes("/episodes?");
    return {
      ok: true,
      json: async () =>
        episodes
          ? {
              data: videos.map((v, i) => ({
                id: String(i + 1),
                attributes: { number: v.episode, canonicalTitle: v.title, airdate: v.released },
              })),
              meta: { count: videos.length },
            }
          : {
              data: {
                id: "12",
                attributes: {
                  canonicalTitle: "Example",
                  subtype: "TV",
                  status: placeholder || upcoming ? "current" : "finished",
                  episodeCount: videos.length,
                },
              },
            },
    };
  };
  const common = {
    "@/lib/media-cache": media,
    "@/lib/cache": {
      lruGet: (map, key) => map.get(key),
      lruSet: (map, key, value) => map.set(key, value),
    },
    "@/lib/memory-profiler": { registerCache() {} },
    "@/lib/safe-fetch": { safeFetch },
    "./source-fingerprint": { sourceFingerprint: (value) => JSON.stringify(value) },
  };
  const mount = () => {
    const addon = load("providers/anime-kitsu-addon", common);
    const kitsu = load("providers/kitsu", {
      ...common,
      "@/lib/request-scheduler": { createRequestScheduler },
      "@/lib/maintenance": { registerEvictable() {} },
      "@/lib/addons-store/adult-filter": { adultContentHidden: () => false },
      "@/lib/episode-text-language": { episodeTextLanguage: () => "en" },
    });
    const no = async () => null;
    const detail = load("providers/anime-detail", {
      "@/lib/media-cache": media,
      "@/lib/providers/anime-kitsu-addon": addon,
      "@/lib/providers/kitsu": {
        ...kitsu,
        kitsuEpisodes: async (...args) => {
          const rows = await kitsu.kitsuEpisodes(...args);
          if (rawGate) await rawGate.promise;
          return rows;
        },
        kitsuCharacters: async () => [],
        kitsuRelated: async () => [],
        kitsuStudios: async () => [],
        kitsuStreamingLinks: async () => [],
      },
      "@/lib/providers/anizip": { aniZipByKitsu: no },
      "@/lib/providers/anime-entry": {},
      "@/lib/providers/anime-episode-build": {
        buildKitsuEpisodes: (meta) =>
          (meta?.videos ?? []).map((v, i) => ({
            id: i + 1,
            number: v.episode,
            streamId: v.id,
            title: v.title,
            thumbnail: v.thumbnail,
            airdate: v.released,
            imdbSeason: v.season,
            imdbEpisode: v.episode,
          })),
        mergeAniZipEpisodes() {},
        mergeTvdbEpisodes() {},
        mergeTmdbEpisodes() {},
      },
      "@/lib/providers/anime-mapping": {
        kitsuToTvdb: no,
        kitsuToImdb: no,
        kitsuToAnilist: no,
        applyAnidbSeasonWindow: no,
      },
      "@/lib/providers/episode-placeholder": { episodesMissingTitle: () => false },
      "@/lib/providers/mal-episodes": {},
      "@/lib/anilist/relations": { anilistFranchise: async () => [] },
      "@/lib/anilist/browse": {},
      "./anime-recommendations": { animeRecommendations: async () => [] },
      "@/lib/providers/anime-episode-enrich": { enrichEpisodes: async () => {} },
      "@/lib/providers/harbor-imdb": { harborImdbEpisodes: async () => new Map() },
      "@/lib/providers/fanart": {},
      "@/lib/providers/tvdb-proxy": { fetchTvdbArtwork: async () => ({}) },
      "@/lib/providers/tvdb": {},
      "@/lib/providers/tmdb": {},
    });
    return { addon, kitsu, detail };
  };
  let modules = mount();
  const loadDetail = async () => {
    const result = await modules.detail.animeDetails(
      { uiLanguage: "en" },
      { id: "kitsu:12", name: "Example" },
    );
    await result.enrichPromise;
    await tick();
    return result;
  };
  return {
    loadDetail,
    get addon() {
      return modules.addon;
    },
    get kitsu() {
      return modules.kitsu;
    },
    needsRefresh: () =>
      modules.detail.animeDetailsNeedRefresh(
        { uiLanguage: "en" },
        { id: "kitsu:12", name: "Example" },
      ),
    restart: () => {
      modules = mount();
    },
    floodProviders: async (count = 320) => {
      for (let id = 900_000; id < 900_000 + count; id += 1) {
        await modules.kitsu.kitsuAnime(id);
      }
      for (let id = 900_000; id < 900_000 + count; id += 1) {
        await modules.addon.animeKitsuMeta(`kitsu:${id}`);
      }
    },
    requests,
    holdRaw: () => {
      rawGate = deferred();
      return rawGate;
    },
    media,
    fetches: () => fetches,
    advance: (ms) => {
      now += ms;
    },
    offline: (value) => {
      offline = value;
    },
    update: () => {
      videos = [
        { ...videos[0], title: "Corrected", thumbnail: "new.jpg", released: "2020-02-01" },
        { id: "kitsu:12:2", season: 1, episode: 2, title: "New episode" },
      ];
    },
  };
}

test("provider expiry refreshes episode sources without restarting or clearing caches", async () => {
  const f = fixture();
  const first = await f.loadDetail();
  assert.equal(first.episodes[0].title, "Old");
  f.update();
  const warm = await f.loadDetail();
  assert.equal(warm.episodes[0].title, "Old");
  assert.equal(f.fetches(), 1);
  f.advance(12 * 60 * 60_000 + 1);
  const [desktop, bigPicture] = await Promise.all([f.loadDetail(), f.loadDetail()]);
  assert.equal(desktop, bigPicture);
  assert.equal(desktop.episodes.length, 2);
  assert.equal(desktop.episodes[0].title, "Corrected");
  assert.equal(desktop.episodes[0].thumbnail, "new.jpg");
  assert.equal(desktop.episodes[0].airdate, "2020-02-01");
  assert.equal(desktop.episodes[0].streamId, "kitsu:12:1");
  assert.equal(f.fetches(), 2, "both views share one provider refresh");
});

test("a newly refreshed provider snapshot invalidates an otherwise warm derived detail", async () => {
  const f = fixture();
  await f.loadDetail();
  f.update();
  await f.addon.animeKitsuMeta("kitsu:12", 0);
  assert.equal((await f.loadDetail()).episodes.length, 2);
  assert.equal(f.fetches(), 2);
});

test("offline stale detail remains playable and can refresh promptly when connectivity returns", async () => {
  const f = fixture();
  await f.loadDetail();
  f.advance(12 * 60 * 60_000 + 1);
  f.offline(true);
  const stale = await f.loadDetail();
  assert.equal(stale.episodes[0].streamId, "kitsu:12:1");
  f.update();
  f.offline(false);
  f.advance(30_001);
  assert.equal((await f.loadDetail()).episodes.length, 2);
});

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

for (const surface of ["desktop", "big-picture"]) {
  test(`${surface} refresh keeps playable rows mounted and rejects late enrichment from an older request`, async () => {
    const path =
      surface === "desktop"
        ? "../src/views/detail.tsx"
        : "../src/views/big-picture/use-bp-anime-detail.ts";
    const source = readFileSync(new URL(path, import.meta.url), "utf8");
    const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let effect;
    const visit = (node) => {
      if (
        ts.isCallExpression(node) &&
        node.expression.getText(ast) === "useEffect" &&
        node.arguments[0]?.getText(ast).includes("const request = ++generation")
      )
        effect = node.arguments[0].getText(ast);
      ts.forEachChild(node, visit);
    };
    visit(ast);
    assert.ok(effect, "execute the production loading effect");
    const oldEnrichment = deferred();
    const refreshed = deferred();
    const events = new EventTarget();
    const doc = Object.assign(new EventTarget(), { visibilityState: "visible" });
    let episodes = [];
    let loaded = null;
    let detail = null;
    let calls = 0;
    let needsRefresh = false;
    const result = (title, enrichment = Promise.resolve([{ streamId: "kitsu:12:1", title }])) => ({
      kitsuId: 12,
      detail: { title: "Example" },
      episodes: [{ streamId: "kitsu:12:1", title }],
      streamers: [],
      backdrops: [],
      franchisePromise: Promise.resolve([]),
      enrichPromise: enrichment,
      heroBgPromise: Promise.resolve(null),
      extrasPromise: Promise.resolve({}),
    });
    const scope = {
      addonNative: false,
      capstanCanonicalId: null,
      capstanMeta: null,
      isAnime: true,
      idAnime: true,
      detectedKitsu: null,
      meta: { id: "kitsu:12", name: "Example", type: "anime" },
      metaId: "kitsu:12",
      metaRef: { current: { id: "kitsu:12", name: "Example", type: "anime" } },
      settingsRef: { current: {} },
      failedKitsu: { current: null },
      setDetectedKitsu() {},
      setLoading() {},
      setSettled() {},
      animeDetailsNeedRefresh: () => needsRefresh,
      animeDetails: () =>
        ++calls === 1 ? Promise.resolve(result("Old", oldEnrichment.promise)) : refreshed.promise,
      setLoaded: (value) => {
        loaded = typeof value === "function" ? value(loaded) : value;
        episodes = loaded?.episodes ?? [];
      },
      setAnimeEpisodes: (value) => {
        episodes = value;
      },
      setAnimeCanonicalId() {},
      setFranchise() {},
      setStreamers() {},
      setBackdrops() {},
      setEnrichedBg() {},
      saveAnimeArt() {},
      setDetail: (value) => {
        detail = typeof value === "function" ? value(detail) : value;
      },
      mergeAnimeDetailExtras: (value) => value,
      NOOP() {},
      window: events,
      document: doc,
    };
    const code = ts.transpileModule(`return (${effect})();`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const cleanup = new Function(...Object.keys(scope), code)(...Object.values(scope));
    await tick();
    assert.equal(episodes[0].title, "Old");
    events.dispatchEvent(new Event("focus"));
    assert.equal(calls, 1, "fresh focus must not rebuild or reapply the detail snapshot");
    needsRefresh = true;
    events.dispatchEvent(new Event("focus"));
    assert.equal(calls, 2);
    assert.equal(episodes[0].title, "Old", "refresh must retain the mounted playable list");
    refreshed.resolve(result("New"));
    await tick();
    oldEnrichment.resolve([{ streamId: "kitsu:12:1", title: "Late old result" }]);
    await tick();
    assert.equal(episodes[0].title, "New");
    assert.equal(episodes[0].streamId, "kitsu:12:1");
    cleanup();
    events.dispatchEvent(new Event("focus"));
    assert.equal(calls, 2);
  });
}

test("a provider refresh during an older detail load cannot repopulate the cache with old episodes", async () => {
  const f = fixture();
  const gate = f.holdRaw();
  const old = f.loadDetail();
  await tick();
  f.update();
  await f.addon.animeKitsuMeta("kitsu:12", 0);
  gate.resolve();
  const latest = await old;
  assert.equal(latest.episodes.length, 2);
  assert.equal(latest.episodes[0].title, "Corrected");
  assert.equal((await f.loadDetail()).episodes.length, 2);
});

test("unused short Kitsu prefixes do not shorten a fresh detail snapshot's lifetime", async () => {
  const f = fixture();
  await f.kitsu.kitsuEpisodes(12, 1);
  f.advance(300_001);
  await f.loadDetail();
  const firstWarm = await f.loadDetail();
  const secondWarm = await f.loadDetail();
  assert.equal(firstWarm, secondWarm);
  assert.equal(f.fetches(), 1);
});

test("provider LRU eviction does not invalidate a warm anime detail", async () => {
  const f = fixture();
  const first = await f.loadDetail();
  await f.floodProviders();
  const requests = f.requests.length;
  assert.equal(f.needsRefresh(), false, "eviction is not a metadata change");
  const warm = await f.loadDetail();
  assert.equal(warm.episodes, first.episodes, "the mounted episode snapshot must survive eviction");
  assert.equal(f.requests.length, requests, "a revisit must not reload the anchor providers");
});

for (const placeholder of [false, true]) {
  test(`${placeholder ? "airing placeholder" : "completed"} detail preserves the provider request budget across opens and focus checks`, async () => {
    const f = fixture({ placeholder });
    const first = await f.loadDetail();
    assert.equal(f.requests.length, 3);
    for (const elapsed of [60_000, 300_001, 360_000, 19 * 60_000]) {
      f.advance(elapsed);
      assert.equal(
        f.needsRefresh(),
        false,
        "provider data remains fresh even after detail reuse expires",
      );
      assert.equal(
        (await f.loadDetail()).episodes,
        first.episodes,
        "reopening must reuse the mounted episode snapshot",
      );
      assert.equal(
        f.requests.length,
        3,
        "reopening must reuse provider memory or durable snapshots",
      );
    }
    f.restart();
    await f.loadDetail();
    assert.equal(f.requests.length, 3, "fresh durable snapshots survive a cold module restart");
  });
}

test("an aired placeholder refreshes on its existing one-hour provider policy", async () => {
  const f = fixture({ placeholder: true });
  await f.loadDetail();
  f.advance(6 * 60_000);
  await f.loadDetail();
  assert.equal(f.requests.length, 3);
  f.update();
  f.advance(55 * 60_000);
  assert.equal(f.needsRefresh(), true);
  const updated = await f.loadDetail();
  assert.equal(updated.episodes[0].title, "Corrected");
  assert.equal(updated.episodes.length, 2);
  assert.equal(
    f.requests.length,
    5,
    "only stale addon and episode sources refresh; anime metadata stays cached",
  );
});

test("identical provider reloads preserve content revisions and warm detail identity", async () => {
  const f = fixture();
  await f.loadDetail();
  const warm = await f.loadDetail();
  const addonVersion = f.addon.animeKitsuMetaVersion("kitsu:12");
  const kitsuVersion = f.kitsu.kitsuEpisodeSourceVersion(12);
  f.advance(1);
  await f.addon.animeKitsuMeta("kitsu:12", 0);
  await f.kitsu.kitsuAnime(12, 0);
  await f.kitsu.kitsuEpisodes(12, 100, 0);
  assert.equal(f.addon.animeKitsuMetaVersion("kitsu:12"), addonVersion);
  assert.equal(f.kitsu.kitsuEpisodeSourceVersion(12), kitsuVersion);
  assert.equal(f.needsRefresh(), false);
  assert.equal(await f.loadDetail(), warm);
});

test("reconfirming an absent addon does not invent a new source revision", async () => {
  const f = fixture({ absent: true });
  assert.equal(await f.addon.animeKitsuMeta("kitsu:12"), null);
  const version = f.addon.animeKitsuMetaVersion("kitsu:12");
  f.advance(30 * 60_000 + 1);
  assert.equal(await f.addon.animeKitsuMeta("kitsu:12"), null);
  assert.equal(f.addon.animeKitsuMetaVersion("kitsu:12"), version);
  assert.equal(f.fetches(), 4, "both probes were repeated after normal negative-cache expiry");
});

test("upcoming episodes retain their original freshness deadline as the air date passes", async () => {
  const f = fixture({ upcoming: true });
  await f.loadDetail();
  const deadline = f.addon.animeKitsuMetaFreshUntil("kitsu:12");
  for (const elapsed of [6 * 60_000, 12 * 60_000, 50 * 60_000]) {
    f.advance(elapsed);
    assert.equal(f.addon.animeKitsuMetaFreshUntil("kitsu:12"), deadline);
    assert.equal(f.needsRefresh(), false);
    await f.loadDetail();
    assert.equal(f.requests.length, 3);
  }
  f.update();
  f.advance(3 * 60_000);
  assert.equal(f.needsRefresh(), true);
  assert.equal((await f.loadDetail()).episodes[0].title, "Corrected");
  assert.equal(f.requests.length, 5);
});
