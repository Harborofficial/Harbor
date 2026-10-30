import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { animeSeasonKey } from "../src/views/detail/anime-episodes/anime-season-key.ts";
import { airedOnly } from "../src/views/detail/helpers.ts";
import { spoilerMaskFor } from "../src/lib/spoilers.ts";
import * as watchedOrder from "../src/lib/publicmetadb/watched-order.ts";
import { isTmdbSingleSeasonShowCached } from "../src/lib/publicmetadb/ids.ts";
import {
  playbackParams,
  playbackPersistenceHarness,
} from "./helpers/playback-persistence-harness.ts";

const IMDB = "tt12590266";
const ORIGINAL = "kitsu:43248";
const SEQUEL = "kitsu:50016";
const settings = {
  hideSpoilers: true,
  spoilerHideThumbnails: true,
  spoilerHideTitles: true,
  spoilerHideDescriptions: true,
  spoilerSkipNext: true,
};

function load(path, dependencies) {
  const compiled = ts.transpileModule(
    readFileSync(new URL(`../${path}`, import.meta.url), "utf8"),
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } },
  ).outputText;
  const exports = {};
  new Function("require", "exports", compiled)((id) => {
    assert.ok(id in dependencies, `Unexpected dependency: ${id}`);
    return dependencies[id];
  }, exports);
  return exports;
}

function harness() {
  const manual = new Map();
  const resumes = new Map();
  const key = (id, season, episode) => `${id}|${season}|${episode}`;
  const manualWatchedState = (id, season, episode) => manual.get(key(id, season, episode));
  const progress = load("src/lib/episode-progress.ts", {
    "@/lib/manual-watched": {
      manualWatchedState,
      createManualWatchedReader: () => manualWatchedState,
    },
    "@/lib/publicmetadb/watched-order": watchedOrder,
    "@/lib/resume": {
      lastPlayedEpisode: () => null,
      readResumeEntry: (id, season, episode) => resumes.get(key(id, season, episode)) ?? null,
      createResumeReader: () => (id, season, episode) =>
        resumes.get(key(id, season, episode)) ?? null,
    },
  });
  const { useAnimeProgressMap } = load(
    "src/views/detail/anime-episodes/use-anime-progress-map.ts",
    {
      react: { useMemo: (fn) => fn() },
      "@/lib/episode-progress": progress,
      "@/lib/manual-watched": { manualWatchedState },
      "@/lib/spoilers": { spoilerMaskFor },
      "../helpers": { airedOnly },
      "./anime-season-key": { animeSeasonKey },
    },
  );
  return {
    getEpisodeProgress: progress.getEpisodeProgress,
    recordManualWatchedMeta: () => {},
    setManualWatchedMany(id, episodes, watched) {
      for (const ep of episodes) manual.set(key(id, ep.season, ep.episode), watched);
    },
    watch(id, season, episode, watched = true) {
      manual.set(key(id, season, episode), watched);
    },
    resume(id, season, episode, ms, t, pct) {
      resumes.set(key(id, season, episode), { ms, t, pct });
    },
    query(overrides = {}) {
      const p = {
        id: SEQUEL,
        season: 1,
        episode: 1,
        runtime: 28,
        imdb: IMDB,
        trakt: new Set(),
        mappedSeason: 2,
        mappedEpisode: 1,
        absolute: 11,
        ...overrides,
      };
      return progress.getEpisodeProgress(
        p.id,
        p.season,
        p.episode,
        p.runtime,
        p.imdb,
        p.trakt,
        p.stremio,
        p.anilist,
        p.simkl,
        p.mal,
        p.mappedSeason,
        p.mappedEpisode,
        p.pmdb,
        p.absolute,
      );
    },
    render(episodes, displayEpisodes, metaId) {
      return useAnimeProgressMap({
        episodes,
        displayEpisodes,
        metaId,
        traktWatched: new Set(),
        mwVersion: 1,
        settings,
      });
    },
  };
}

function sequelEpisode(number, patch = {}) {
  return {
    id: 5001600 + number,
    number,
    seasonNumber: 1,
    title: `Episode ${number}`,
    synopsis: "",
    thumbnail: null,
    airdate: "2022-09-13",
    length: 28,
    imdbId: IMDB,
    imdbSeason: 2,
    imdbEpisode: number,
    absoluteNumber: 10 + number,
    sourceMetaId: SEQUEL,
    ...patch,
  };
}

function finishPlayback(owner, season, episode, mappedSeason = season) {
  const playback = playbackPersistenceHarness();
  let params = playbackParams(season, episode);
  params.src.meta = { id: owner, type: "series", name: "Cyberpunk: Edgerunners" };
  params.src.episode.imdbSeason = mappedSeason;
  playback.render(params);
  params = {
    ...params,
    snap: { ...params.snap, status: "playing", positionSec: 1550, durationSec: 1680 },
  };
  playback.render(params);
  playback.clock(1550);
  playback.tick();
  playback.unmount();
  assert.deepEqual(playback.watched, [[owner, mappedSeason, episode, true]]);
  return playback.watched;
}

test("Season 1 playback completion leaves sequel progress isolated on both navigation paths", () => {
  for (const owner of [IMDB, ORIGINAL]) {
    const h = harness();
    const writes = [1, 2].flatMap((episode) => finishPlayback(owner, 1, episode));
    for (const write of writes) h.watch(...write);
    for (const direct of [false, true]) {
      const display = [1, 2].map((number) =>
        sequelEpisode(number, direct ? { sourceMetaId: undefined } : {}),
      );
      const result = h.render(display, display, direct ? SEQUEL : ORIGINAL);
      for (const ep of display) assert.equal(result.progressFor(ep).watched, false);
      assert.equal(result.allWatched, false);
      assert.equal(result.nextUpId, display[0].id);
      assert.equal(result.nextUpNum, 1);
      assert.equal(result.spoilerFor(display[1]).title, true);
    }
    assert.equal(h.query({ id: owner, mappedSeason: 1, absolute: 1 }).watched, true);
  }
});

test("genuine sequel playback remains watched without marking the original", () => {
  for (const owner of [IMDB, SEQUEL]) {
    const h = harness();
    for (const write of finishPlayback(owner, owner === IMDB ? 2 : 1, 1, 2)) h.watch(...write);
    const first = sequelEpisode(1);
    const second = sequelEpisode(2);
    const result = h.render([first, second], [first, second], ORIGINAL);
    assert.equal(result.progressFor(first).watched, true);
    assert.equal(result.nextUpId, second.id);
    assert.equal(result.allWatched, false);
    assert.equal(h.render([first], [first], ORIGINAL).allWatched, true);
    assert.equal(h.query({ id: ORIGINAL, mappedSeason: 1, absolute: 1 }).watched, false);
  }
});

test("resume checkpoints use each ID's own coordinates and newest valid timestamp", () => {
  const h = harness();
  h.resume(SEQUEL, 1, 1, 300000, 2);
  h.resume(IMDB, 1, 1, 1550000, 5);
  h.resume(IMDB, 2, 1, 600000, 3);
  assert.deepEqual(h.query(), { ratio: 600000 / 1680000, watched: false, startedAt: 3 });
  assert.deepEqual(h.query({ id: IMDB, season: 2 }), {
    ratio: 600000 / 1680000,
    watched: false,
    startedAt: 3,
  });
  h.resume(SEQUEL, 1, 1, 0, 6, 0.9);
  assert.equal(h.query().watched, true);
  assert.equal(h.query().startedAt, 6);
});

test("mapped episode numbers within one season cannot inherit native IMDb coordinates", () => {
  const h = harness();
  h.watch(IMDB, 1, 1);
  h.resume(IMDB, 1, 1, 1550000, 3);
  const target = { mappedSeason: 1, mappedEpisode: 13, absolute: 13 };
  assert.equal(h.query(target).watched, false);
  assert.equal(h.query({ ...target, id: IMDB, episode: 13 }).watched, false);
  h.watch(IMDB, 1, 13);
  assert.equal(h.query(target).watched, true);
});

test("PublicMetaDB uses only mapped coordinates when native numbering differs", () => {
  const h = harness();
  for (const key of ["1:1", `imdb:${IMDB}:1:1`, "1:11", `imdb:${IMDB}:1:11`]) {
    assert.equal(h.query({ pmdb: new Set([key]) }).watched, false, key);
  }
  for (const key of ["2:1", `imdb:${IMDB}:2:1`]) {
    assert.equal(h.query({ pmdb: new Set([key]) }).watched, true, key);
  }
  assert.equal(
    h.query({
      id: "tmdb:tv:384541",
      pmdb: new Set(["tmdb:tv:384541:1:1"]),
    }).watched,
    false,
  );
  assert.equal(
    h.query({
      id: "tmdb:tv:384541",
      pmdb: new Set(["tmdb:tv:384541:2:1"]),
    }).watched,
    true,
  );
});

test("missing or incomplete anime mappings cannot borrow provider watched or resume records", () => {
  for (const mapping of [
    { mappedSeason: undefined, mappedEpisode: undefined },
    { mappedSeason: undefined, mappedEpisode: 1 },
    { mappedSeason: 1, mappedEpisode: undefined },
    { mappedSeason: 1, mappedEpisode: Number.NaN },
  ]) {
    const h = harness();
    h.watch(IMDB, 1, 1);
    h.resume(IMDB, 1, 1, 1550000, 3);
    const target = {
      ...mapping,
      trakt: new Set([`imdb:${IMDB}:1:1`]),
      pmdb: new Set(["1:1", `imdb:${IMDB}:1:1`]),
    };
    assert.deepEqual(h.query(target), { ratio: 0, watched: false, startedAt: 0 });
    h.watch(SEQUEL, 1, 1);
    assert.equal(h.query(target).watched, true);
  }
});

test("native watched, same-entry legacy coordinates, and explicit unwatch keep precedence", () => {
  const h = harness();
  h.watch(SEQUEL, 1, 1);
  assert.equal(h.query().watched, true);
  h.watch(SEQUEL, 1, 1, false);
  h.watch(SEQUEL, 2, 1);
  h.watch(IMDB, 2, 1);
  h.resume(IMDB, 2, 1, 1550000, 3);
  assert.equal(h.query({ trakt: new Set([`imdb:${IMDB}:2:1`]) }).watched, false);
  const legacy = harness();
  legacy.watch(SEQUEL, 2, 1);
  assert.equal(legacy.query().watched, true);
  legacy.watch(IMDB, 2, 1, false);
  assert.equal(legacy.query({ id: IMDB, season: 2 }).watched, false);
});

test("specials accept mapped season zero while keeping regular episodes separate", () => {
  const h = harness();
  h.watch(IMDB, 1, 1);
  assert.equal(h.query({ mappedSeason: 0 }).watched, false);
  h.watch(IMDB, 0, 1);
  assert.equal(h.query({ mappedSeason: 0 }).watched, true);
});

test("ordinary series and entry-scoped anime trackers retain existing progress behavior", () => {
  const h = harness();
  const ordinary = { id: "tmdb:tv:384541", mappedSeason: undefined, mappedEpisode: undefined };
  h.watch(IMDB, 1, 1);
  assert.equal(h.query(ordinary).watched, true);
  const empty = harness();
  for (const provider of ["stremio", "anilist", "simkl", "mal"]) {
    assert.equal(empty.query({ [provider]: new Set(["1:1"]) }).watched, true, provider);
  }
  assert.equal(empty.query({ ...ordinary, pmdb: new Set(["1:11"]) }).watched, true);
});

test("production bulk watched and unwatch keep the primary IMDb storage coordinates", () => {
  const h = harness();
  const { useAnimeWatchedRouting } = load(
    "src/views/detail/anime-episodes/use-anime-watched-routing.ts",
    {
      react: { useMemo: (fn) => fn() },
      "@/lib/manual-watched": h,
      "@/lib/anilist/sync": {},
      "@/lib/mal/sync": {},
      "@/lib/settings": { useSettings: () => ({ settings: {} }) },
      "../helpers": { airedOnly },
      "./anime-season-key": { animeSeasonKey },
    },
  );
  const ep = sequelEpisode(1, {
    sourceMetaId: undefined,
    imdbSeason: 1,
    imdbEpisode: 13,
    absoluteNumber: 13,
  });
  const routing = useAnimeWatchedRouting(
    { id: IMDB, type: "series", name: "Mapped anime" },
    [],
    SEQUEL,
  );
  const target = { id: IMDB, mappedSeason: 1, mappedEpisode: 13 };
  routing.markMany([ep], true);
  assert.equal(h.query(target).watched, true);
  routing.markMany([ep], false);
  assert.equal(
    h.query({
      ...target,
      trakt: new Set(["imdb:" + IMDB + ":1:13"]),
    }).watched,
    false,
  );
});

test("actual IMDb autosave checkpoints remain readable at their primary coordinates", () => {
  const playback = playbackPersistenceHarness();
  let params = playbackParams(1, 1);
  params.src.meta.id = IMDB;
  params.src.episode.imdbSeason = 2;
  playback.render(params);
  params = {
    ...params,
    snap: { ...params.snap, status: "playing", positionSec: 300, durationSec: 1680 },
  };
  playback.render(params);
  playback.clock(300);
  playback.tick();
  playback.unmount();
  const h = harness();
  for (const [id, ms, season, episode] of playback.writes) h.resume(id, season, episode, ms, 1);
  assert.deepEqual(h.query({ id: IMDB }), {
    ratio: 300000 / 1680000,
    watched: false,
    startedAt: 1,
  });
  assert.deepEqual(h.query(), { ratio: 0, watched: false, startedAt: 0 });
});

test("PMDB resolver and targeted history preserve a verified single-season absolute order", async () => {
  const { resolvePmdbEpisodeTarget } = load("src/lib/publicmetadb/ids.ts", {
    "@/lib/providers/anizip": {
      aniZipByKitsu: async () => ({
        mappings: { themoviedb_id: 65942, imdb_id: "tt5607616" },
        episodes: {
          14: { seasonNumber: 2, episodeNumber: 14, absoluteEpisodeNumber: 39 },
        },
      }),
    },
    "@/lib/providers/anime-mapping": {},
    "@/lib/providers/tmdb/tmdb-client": {},
  });
  const target = await resolvePmdbEpisodeTarget("kitsu:43247", {
    season: 1,
    episode: 14,
    imdbSeason: 2,
    imdbEpisode: 14,
    absoluteNumber: 39,
  });
  assert.equal(target.season, 1);
  assert.equal(target.episode, 39);
  const { fetchPmdbWatchedKeySet } = load("src/lib/publicmetadb/history.ts", {
    "./client": {
      pmdbRequest: async () => ({
        totalPages: 1,
        items: [{ tmdb_id: 65942, media_type: "tv", season: 1, episode: 39 }],
      }),
    },
    "./mappings": {},
    "./session": { isAuthenticated: () => true },
    "./ids": { isTmdbSingleSeasonShowCached },
    "./watched-order": watchedOrder,
  });
  const keys = await fetchPmdbWatchedKeySet({ tmdb_id: 65942, media_type: "tv" });
  const h = harness();
  const episode = {
    id: "kitsu:43247",
    episode: 14,
    imdb: "tt5607616",
    mappedSeason: 2,
    mappedEpisode: 14,
    absolute: 39,
  };
  assert.equal(h.query({ ...episode, pmdb: keys }).watched, true);
  assert.equal(h.query({ ...episode, pmdb: new Set(keys) }).watched, false);
  const global = await fetchPmdbWatchedKeySet();
  assert.equal(h.query({ ...episode, pmdb: global }).watched, false);
  const unrelated = await fetchPmdbWatchedKeySet({ tmdb_id: 384541, media_type: "tv" });
  assert.equal(h.query({ ...episode, pmdb: unrelated }).watched, false);
});

test("the production cast progress callback forwards its loaded anime mapping", () => {
  const path = "src/components/player/cast-modal/episode-picker.tsx";
  const source = readFileSync(new URL("../" + path, import.meta.url), "utf8");
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback;
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "progressFor")
      callback = node.initializer.getText(ast);
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.ok(callback);
  const compiled = ts.transpile("const progressFor = " + callback + "; return progressFor;", {
    target: ts.ScriptTarget.ES2022,
  });
  const h = harness();
  const progressFor = new Function(
    "getEpisodeProgress",
    "meta",
    "imdbId",
    "traktWatched",
    "simklWatched",
    compiled,
  )(h.getEpisodeProgress, { id: SEQUEL }, IMDB, new Set(["imdb:" + IMDB + ":2:1"]), new Set());
  assert.equal(
    progressFor({
      season: 1,
      episode: 1,
      runtime: 28,
      imdbSeason: 2,
      imdbEpisode: 1,
    }).watched,
    true,
  );
  assert.equal(progressFor({ season: 1, episode: 1, runtime: 28 }).watched, false);
});
