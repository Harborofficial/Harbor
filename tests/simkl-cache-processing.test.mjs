import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function fixture() {
  const session = {};
  const cache = {
    lastSync: "unchanged",
    items: {
      1: { simklId: 1, status: "watching", watchedEpisodes: ["1:2", "1:3"] },
      2: { simklId: 2, status: "completed" },
    },
    imdbToSimkl: { tt1: 1, tt2: 2 },
    tmdbToSimkl: { "tv:10": 1, "movie:20": 2 },
    malToSimkl: { 30: 1 },
    kitsuToSimkl: { 40: 1 },
  };
  let saves = 0;
  const code = ts.transpileModule(
    readFileSync(new URL("../src/lib/simkl/activities/sync.ts", import.meta.url), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  const exports = {};
  const mocks = {
    "../session": { getSession: () => session },
    "@/lib/active-profile-id": { activeProfileId: () => "fixture" },
    "../client": { simklRequest: async () => ({ all: "unchanged" }) },
    "./store": { getLocalCache: () => cache, saveLocalCache: () => saves++ },
  };
  new Function("require", "exports", code)((name) => mocks[name] ?? {}, exports);
  return { exports, cache, saves: () => saves };
}

test("unchanged SIMKL sync reuses the cache without publishing or persisting a copy", async () => {
  const f = fixture();
  assert.equal(await f.exports.syncWatchlistCache(), f.cache);
  assert.equal(f.saves(), 0);
});

test("SIMKL reverse index retains every provider alias and episode membership", async () => {
  const f = fixture();
  const result = await f.exports.getCachedSimklData();
  for (const key of ["tt1", "tmdb:tv:10", "mal:30", "kitsu:40"]) {
    assert.equal(result.statuses.get(key), "watching");
    assert.deepEqual([...result.watched.get(key)], ["1:2", "1:3"]);
  }
  assert.equal(result.statuses.get("tmdb:movie:20"), "completed");
  assert.equal(result.watched.has("tt2"), false);
});
