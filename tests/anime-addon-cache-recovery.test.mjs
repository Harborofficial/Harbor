import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { memoryMediaCache } from "./helpers/media-cache.mjs";

function fixture() {
  let now = Date.now();
  let outcome = "ok";
  let calls = 0;
  const media = memoryMediaCache({ now: () => now });
  const dependencies = {
    "@/lib/cache": {
      lruGet: (map, key) => map.get(key),
      lruSet: (map, key, value) => map.set(key, value),
    },
    "@/lib/memory-profiler": { registerCache() {} },
    "@/lib/media-cache": media,
    "./source-fingerprint": { sourceFingerprint: (value) => JSON.stringify(value) },
    "@/lib/safe-fetch": {
      async safeFetch() {
        calls++;
        if (outcome === "offline") throw new Error("temporary outage");
        const ok = outcome === "ok";
        return {
          ok,
          status: ok ? 200 : 404,
          json: async () => ({
            meta: {
              id: "kitsu:13",
              name: "Example",
              videos: [{ id: "kitsu:13:1", title: "Real title" }],
            },
          }),
        };
      },
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(
    ts.transpileModule(
      readFileSync(new URL("../src/lib/providers/anime-kitsu-addon.ts", import.meta.url), "utf8"),
      {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      },
    ).outputText,
    {
      module,
      exports: module.exports,
      require: (name) => dependencies[name],
      Date: { now: () => now },
    },
  );
  return {
    load: () => module.exports.animeKitsuMeta("kitsu:13"),
    media,
    advance: (ms) => {
      now += ms;
    },
    outcome: (value) => {
      outcome = value;
    },
    calls: () => calls,
  };
}

test("every caller retains the last complete addon metadata through an outage and can retry", async () => {
  const f = fixture();
  assert.ok(await f.load());
  f.advance(13 * 60 * 60_000);
  f.outcome("offline");
  assert.ok(await f.load());
  assert.ok(await f.load(), "a failed refresh must not poison the outer memory cache");
  assert.equal(f.calls(), 2);
  f.advance(30_001);
  f.outcome("ok");
  assert.ok(await f.load());
  assert.equal(f.calls(), 3);
});

test("only a confirmed absence gets the long negative cache, and clearing removes it", async () => {
  const f = fixture();
  f.outcome("offline");
  assert.equal(await f.load(), null);
  f.advance(30_001);
  f.outcome("ok");
  assert.ok(await f.load());
  await f.media.clearMediaCache();
  f.outcome("absent");
  assert.equal(await f.load(), null);
  const calls = f.calls();
  f.advance(60_000);
  assert.equal(await f.load(), null);
  assert.equal(f.calls(), calls);
  await f.media.clearMediaCache();
  f.outcome("ok");
  assert.ok(await f.load());
});
