import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { lruSet } from "../src/lib/cache.ts";
import { MEDIA_TTL } from "../src/lib/media-cache.ts";

test("player episode projections follow language, credentials, expiry and cache clearing", async () => {
  let language = "en-US";
  let now = 1000;
  let generation = 0;
  let fail = false;
  const calls = [];
  const invalidators = [];
  const dependencies = {
    "@/lib/cache": { lruSet },
    "@/lib/memory-profiler": { registerCache() {} },
    "@/lib/media-cache": {
      MEDIA_TTL,
      onMediaCacheClear: (fn) => invalidators.push(fn),
      mediaCacheGeneration: () => generation,
    },
    "./providers/tmdb/tmdb-client": {
      effectiveTmdbLanguage: () => language,
      tmdbLanguageIso: () => language.split("-")[0],
    },
    "./providers/tmdb/tmdb-image-rungs": { tmdbStillUrl: (value) => value },
    "./providers/tmdb": {
      tmdbSeasonEpisodes: async (key) => {
        calls.push([key, language]);
        return fail ? [] : [{ id: 1, seasonNumber: 1, episodeNumber: 1, name: language }];
      },
    },
  };
  const source = ts.transpileModule(
    readFileSync(new URL("../src/lib/series-episodes.ts", import.meta.url), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  const module = { exports: {} };
  vm.runInNewContext(source, {
    module,
    exports: module.exports,
    require: (name) => dependencies[name] ?? {},
    Date: { now: () => now },
  });
  const load = (key = "first") =>
    module.exports.fetchSeasonEpisodes({ id: "tmdb:tv:42", type: "series" }, 1, { tmdbKey: key });
  assert.equal((await load())[0].name, "en-US");
  await load();
  assert.equal(calls.length, 1);
  language = "en-GB";
  assert.equal((await load())[0].name, "en-GB");
  assert.equal(calls.length, 2);
  await load("second");
  assert.equal(calls.length, 3);
  now += MEDIA_TTL.recent + 1;
  await load("second");
  assert.equal(calls.length, 4);
  generation++;
  invalidators.forEach((fn) => fn());
  await load("second");
  assert.equal(calls.length, 5);
  language = "tr";
  fail = true;
  assert.equal((await load()).length, 0);
  fail = false;
  assert.equal((await load())[0].name, "tr");
  assert.equal(calls.length, 7);
});
