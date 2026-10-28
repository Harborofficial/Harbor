import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const firstMeta = { id: "kitsu:45398", type: "series", name: "SPY x FAMILY" };
const nextMeta = { id: "kitsu:45619", type: "series", name: "SPY x FAMILY Part 2" };
const next = { season: 1, episode: 1, kitsuStreamId: "kitsu:45619:1", sourceMetaId: nextMeta.id };

async function navigation({
  local,
  mode = "stream",
  adjacent = { prev: null, next, nextMeta },
} = {}) {
  let state = { prev: null, next: null };
  let effect;
  const lookups = [],
    opened = [],
    played = [],
    requests = [],
    downloads = [];
  const mocks = {
    react: {
      useState: () => [
        state,
        (value) => {
          state = value;
        },
      ],
      useRef: (value) => ({ current: value }),
      useCallback: (fn) => fn,
      useEffect: (fn) => {
        effect = fn;
      },
    },
    "@/lib/cinemeta": { isAddonNativeMeta: () => false },
    "@/lib/series-episodes": {
      fetchAdjacentEpisodes: async (...args) => {
        requests.push(args);
        return adjacent;
      },
    },
    "@/lib/hidden-episodes": {},
    "@/lib/local-library": {
      localShowEpisodes: () => [],
      findLocalEpisode: (key, season, episode) => {
        lookups.push({ key, season, episode });
        return local?.(key, season, episode) ?? null;
      },
    },
    "@/lib/player/local-url": { isLocalUrl: () => true },
    "@/views/library/local-tab/show-group": {
      localPlayerSrc: (entry) => ({ meta: firstMeta, url: entry.path }),
    },
    "@/lib/download/downloads-store": {
      completedDownloadFor: async (...args) => {
        downloads.push(args);
        return null;
      },
    },
    "@/lib/download/player-src": {},
  };
  const source = readFileSync(
    new URL("../src/views/player/hooks/use-episode-navigation.ts", import.meta.url),
    "utf8",
  );
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const api = {};
  new Function("require", "exports", compiled)((name) => {
    assert.ok(name in mocks, `Unexpected dependency ${name}`);
    return mocks[name];
  }, api);
  const params = {
    src: {
      meta: firstMeta,
      url: "file:///Part1-E11-E12.mkv",
      imdbId: "tt13706018",
      isAnime: true,
      episode: { season: 1, episode: 11, kitsuStreamId: "kitsu:45398:11" },
      episodeEnd: 12,
    },
    settings: { tmdbKey: "", episodeHiding: false, localPlaybackMode: mode },
    inRoom: false,
    isHost: true,
    openPicker: (...args) => opened.push(args),
    replacePlayerSrc: (src) => played.push(src),
  };
  api.useEpisodeNavigation(params);
  effect();
  for (let i = 0; i < 8; i++) await Promise.resolve();
  const hook = api.useEpisodeNavigation(params);
  hook.goToEpisode(hook.adjacent.next);
  for (let i = 0; i < 8; i++) await Promise.resolve();
  return { hook, lookups, opened, played, requests, downloads };
}

test("local finale retains sequel metadata and never selects the old cour's E1", async () => {
  const result = await navigation({
    local: (key) => (key.imdbId ? { path: "Part1-E1.mkv" } : null),
  });
  assert.deepEqual(result.hook.adjacent.nextMeta, nextMeta);
  assert.equal(result.played.length, 0);
  assert.deepEqual(result.opened[0], [nextMeta, next, { autoPlay: true }]);
  assert.deepEqual(result.lookups, [{ key: { title: nextMeta.name }, season: 1, episode: 1 }]);
  assert.equal(result.requests[0][1].episode, 12);
  assert.equal(result.requests[0][2].episodeEndOffset, 1);
});

test("a local sequel file plays with its destination metadata and exact episode", async () => {
  const result = await navigation({
    local: (key) => (key.title === nextMeta.name ? { path: "Part2-E1.mkv" } : null),
  });
  assert.equal(result.opened.length, 0);
  assert.equal(result.played[0].url, "Part2-E1.mkv");
  assert.deepEqual(result.played[0].meta, nextMeta);
  assert.deepEqual(result.played[0].episode, next);
});

test("local navigation within the same cour preserves IMDb-based file matching", async () => {
  const episode = { season: 1, episode: 12 };
  const result = await navigation({
    adjacent: { prev: null, next: episode },
    local: (key) => (key.imdbId === "tt13706018" ? { path: "Part1-E12.mkv" } : null),
  });
  assert.equal(result.played[0].url, "Part1-E12.mkv");
  assert.equal(result.lookups[0].key.imdbId, "tt13706018");
});

test("a missing local sequel searches downloads using the sequel ID", async () => {
  const result = await navigation({ mode: "prefer-local" });
  assert.deepEqual(result.downloads, [[nextMeta.id, 1, 1]]);
  assert.deepEqual(result.opened[0], [nextMeta, next, { autoPlay: true }]);
});
