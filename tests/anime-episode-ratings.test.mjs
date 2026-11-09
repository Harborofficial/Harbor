import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { JSDOM } from "jsdom";
import * as React from "react";
import { createRoot } from "react-dom/client";
import { lruSet } from "../src/lib/cache.ts";

function load(path, mocks, globals = {}) {
  const code = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  new Function("require", "exports", ...Object.keys(globals), code)(
    (id) => {
      assert.ok(id in mocks, `Unmocked dependency: ${id}`);
      return mocks[id];
    },
    exports,
    ...Object.values(globals),
  );
  return exports;
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function fixture() {
  let now = 0;
  const requests = [];
  const timers = new Map();
  let evict;
  const provider = load(
    "src/lib/providers/harbor-imdb.ts",
    {
      "@/lib/cache": { lruSet },
      "@/lib/maintenance": {
        registerEvictable: (name, fn) => {
          if (name === "harbor-imdb-episodes") evict = fn;
        },
      },
      "@/lib/config/endpoints": { HARBOR_API_BASE: "https://fixture.invalid" },
      "@/lib/safe-fetch": {
        safeFetch: (url) => {
          const request = { url, ...deferred() };
          requests.push(request);
          return request.promise;
        },
      },
      "@/lib/providers/csm": {},
    },
    { Date: { now: () => now } },
  );
  const { useHarborEpisodeRatings } = load(
    "src/views/detail/use-episode-imdb-ratings.ts",
    {
      react: React,
      "@/lib/providers/harbor-imdb": provider,
      "@/lib/providers/omdb": {},
    },
    {
      setTimeout: (fn, ms) => {
        const timer = {};
        timers.set(timer, { fn, ms });
        return timer;
      },
      clearTimeout: (timer) => timers.delete(timer),
    },
  );
  return {
    ...provider,
    useHarborEpisodeRatings,
    requests,
    timers,
    evict: () => evict(true),
    advance: (ms) => {
      now += ms;
    },
    respond: (index, ratings) =>
      requests[index].resolve({
        ok: true,
        json: async () => ({ ratings }),
      }),
    retry: () => {
      const pending = [...timers.values()];
      timers.clear();
      now += 60_000;
      for (const timer of pending) timer.fn();
    },
  };
}

const { withEpisodeImdbRatings } = load("src/lib/providers/anime-episode-enrich.ts", {
  "@/lib/providers/anime-mapping": {},
  "@/lib/providers/harbor-imdb": {},
  "@/lib/anime-fillers": {},
  "@/lib/providers/anime-tvdb-thumbs": {},
  "@/lib/cinemeta": {},
  "@/lib/providers/tmdb/tmdb-details": {},
  "@/lib/providers/tmdb/tmdb-image-rungs": {},
});

async function withRoot(run) {
  const dom = new JSDOM("<div id='app'></div>", { url: "http://localhost/" });
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    IS_REACT_ACT_ENVIRONMENT: globalThis.IS_REACT_ACT_ENVIRONMENT,
  };
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const root = createRoot(document.getElementById("app"));
  try {
    await run(root);
  } finally {
    await React.act(() => root.unmount());
    Object.assign(globalThis, previous);
    dom.window.close();
  }
}

const episode = (overrides = {}) => ({
  id: 1,
  number: 1,
  title: "Episode",
  imdbSeason: 2,
  imdbEpisode: 1,
  airdate: "2000-01-01",
  ...overrides,
});

test("ratings reach a mounted episode view without any metadata or franchise update", async () => {
  await withRoot(async (root) => {
    const f = fixture();
    const episodes = [episode()];
    let rows;
    function View() {
      const ratings = f.useHarborEpisodeRatings("tt1");
      rows = withEpisodeImdbRatings(episodes, ratings);
      return rows[0].rating ?? "waiting";
    }
    await React.act(() => root.render(React.createElement(View)));
    assert.equal(rows, episodes);
    assert.equal(f.requests.length, 1);
    const duplicate = f.harborImdbEpisodes("tt1");
    assert.equal(f.requests.length, 1);
    await React.act(async () => {
      f.respond(0, { "2:1": 8.2 });
      await duplicate;
    });
    assert.equal(document.getElementById("app").textContent, "8.2");
    assert.equal(rows[0].ratingIsImdb, true);
    assert.equal(episodes[0].rating, undefined, "published metadata remains immutable");
  });
});

test("changing titles isolates late responses and unsubscribes the old cache", async () => {
  await withRoot(async (root) => {
    const f = fixture();
    function View({ id }) {
      return f.useHarborEpisodeRatings(id).get("2:1") ?? "waiting";
    }
    await React.act(() => root.render(React.createElement(View, { id: "tt1" })));
    await React.act(() => root.render(React.createElement(View, { id: "tt2" })));
    await React.act(async () => f.respond(0, { "2:1": 9 }));
    assert.equal(document.getElementById("app").textContent, "waiting");
    await React.act(async () => f.respond(1, { "2:1": 7 }));
    assert.equal(document.getElementById("app").textContent, "7");
    await React.act(() => f.evict());
    assert.equal(document.getElementById("app").textContent, "waiting");
  });
});

test("empty responses retry once after backoff, and title changes cancel retries", async () => {
  await withRoot(async (root) => {
    const f = fixture();
    function View({ id }) {
      return f.useHarborEpisodeRatings(id).get("2:1") ?? "waiting";
    }
    await React.act(() => root.render(React.createElement(View, { id: "tt1" })));
    await React.act(async () => f.respond(0, {}));
    assert.equal(f.timers.size, 1);
    assert.equal([...f.timers.values()][0].ms, 60_000);
    await React.act(() => f.retry());
    await React.act(async () => f.respond(1, {}));
    assert.equal(f.timers.size, 0, "a repeated outage cannot poll indefinitely");
    await React.act(() => root.render(React.createElement(View, { id: "tt2" })));
    await React.act(async () => f.respond(2, {}));
    assert.equal(f.timers.size, 1);
    await React.act(() => root.render(React.createElement(View, { id: null })));
    assert.equal(f.timers.size, 0);
  });
});

test("a successful retry updates badges without leaving the view", async () => {
  await withRoot(async (root) => {
    const f = fixture();
    function View() {
      return f.useHarborEpisodeRatings("tt1").get("2:1") ?? "waiting";
    }
    await React.act(() => root.render(React.createElement(View)));
    await React.act(async () => f.respond(0, {}));
    await React.act(() => f.retry());
    await React.act(async () => f.respond(1, { "2:1": 8.5 }));
    assert.equal(document.getElementById("app").textContent, "8.5");
    assert.equal(f.timers.size, 0);
  });
});

test("ratings preserve mapped cour coordinates, Specials, unaired guards and row identity", () => {
  const rows = [
    episode(),
    episode({ id: 2, imdbSeason: 3, absoluteNumber: 26 }),
    episode({ id: 3, imdbSeason: 0, imdbEpisode: 2 }),
    episode({ id: 4, airdate: "2999-01-01" }),
    episode({ id: 5, airdate: null }),
    episode({
      id: 6,
      imdbSeason: undefined,
      imdbEpisode: undefined,
      seasonNumber: 1,
      airdate: null,
    }),
  ];
  const ratings = new Map([
    ["2:1", 8.2],
    ["1:26", 8.6],
    ["0:2", 7.3],
    ["1:1", 9],
  ]);
  const rated = withEpisodeImdbRatings(rows, ratings);
  assert.deepEqual(
    rated.slice(0, 3).map((ep) => ep.rating),
    [8.2, 8.6, 7.3],
  );
  assert.equal(rated[3], rows[3]);
  assert.equal(rated[4], rows[4]);
  assert.equal(rated[5], rows[5]);
  assert.equal(withEpisodeImdbRatings(rated, ratings), rated);
  assert.equal(withEpisodeImdbRatings(rows, new Map()), rows);
  assert.equal(rows[0].rating, undefined);
});

test("franchise rows never receive the anchor series' ratings", () => {
  const anchor = episode({
    id: 1,
    sourceMetaId: undefined,
    imdbId: "tt1",
    imdbSeason: 1,
    imdbEpisode: 1,
  });
  const sequel = episode({
    id: 2,
    sourceMetaId: "kitsu:2",
    imdbId: "tt2",
    imdbSeason: 1,
    imdbEpisode: 1,
  });
  const ratings = new Map([["1:1", 8.4]]);
  const rated = withEpisodeImdbRatings([anchor, sequel], ratings, {
    seriesMetaId: "kitsu:1",
    seriesImdbId: "tt1",
  });
  assert.equal(rated[0].rating, 8.4);
  assert.equal(rated[1], sequel);
  assert.equal(sequel.rating, undefined);
});

test("subscribers are notified after publication and stop receiving updates after unsubscribe", async () => {
  const f = fixture();
  const seen = [];
  const unsubscribe = f.subscribeHarborImdbEpisodes("tt1", () => {
    seen.push(f.harborImdbEpisodesCached("tt1")?.get("2:1"));
  });
  const work = f.harborImdbEpisodes("tt1");
  f.respond(0, { "2:1": 8.2, "2:2": 11 });
  await work;
  assert.deepEqual(seen, [8.2]);
  assert.equal(f.harborImdbEpisodesCached("tt1").has("2:2"), false);
  unsubscribe();
  f.evict();
  assert.deepEqual(seen, [8.2]);
});
