import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { createMediaCache, episodeCacheTtl, MEDIA_TTL } from "../src/lib/media-cache.ts";

function fixture({ records = new Map(), legacy = new Map(), persist = true } = {}) {
  let now = Date.now();
  const invalidators = [];
  const cache = createMediaCache(
    {
      async get(key) {
        return records.get(key) ?? null;
      },
      async put(record) {
        if (persist) records.set(record.key, structuredClone(record));
        return persist;
      },
      async list() {
        return [...records.values()];
      },
      async remove(keys) {
        keys.forEach((key) => records.delete(key));
      },
      async clear() {
        records.clear();
        return true;
      },
    },
    { now: () => now },
  );
  const key = (namespace, scope) => `${namespace}:${JSON.stringify(scope)}`;
  const api = {
    MEDIA_TTL,
    episodeCacheTtl,
    mediaCacheGeneration: cache.generation,
    onMediaCacheClear: (fn) => invalidators.push(fn),
    readMedia: (namespace, scope) => cache.peek(key(namespace, scope)),
    loadMedia: (namespace, scope, loader, policy) =>
      cache.load(key(namespace, scope), loader, policy),
    saveMedia: (namespace, scope, value, policy, storedAt, generation) =>
      generation === cache.generation() &&
      cache.save(key(namespace, scope), value, policy, storedAt),
  };
  const module = { exports: {} };
  const source = ts.transpileModule(
    readFileSync(new URL("../src/lib/cinemeta-cache.ts", import.meta.url), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  vm.runInNewContext(source, {
    module,
    exports: module.exports,
    require: (name) => {
      assert.equal(name, "./media-cache");
      return api;
    },
    localStorage: {
      getItem: (key) => legacy.get(key) ?? null,
      setItem: (key, value) => legacy.set(key, value),
      removeItem: (key) => legacy.delete(key),
    },
  });
  return {
    ...module.exports,
    records,
    legacy,
    advance(ms) {
      now += ms;
    },
    async clear() {
      const done = cache.clear();
      invalidators.forEach((fn) => fn());
      return done;
    },
  };
}
const metadata = () => ({
  id: "tt1",
  type: "series",
  name: "One Piece",
  videos: Array.from({ length: 1400 }, (_, i) => ({
    id: `tt1:1:${i + 1}`,
    season: 1,
    episode: i + 1,
    name: `Real title ${i + 1}`,
  })),
});

test("large Cinemeta episode lists persist whole across restart without localStorage writes", async () => {
  const first = fixture();
  const raw = metadata();
  let calls = 0;
  const loader = async () => {
    calls++;
    return { value: raw, cacheable: true };
  };
  const result = await first.withMetaCache("series", "tt1", loader);
  assert.equal(result.videos.length, 1400);
  result.videos.pop();
  raw.videos.pop();
  const restarted = fixture({ records: first.records });
  assert.equal((await restarted.withMetaCache("series", "tt1", loader)).videos.length, 1400);
  assert.equal(calls, 1);
  assert.equal(first.legacy.size, 0);
});

test("legacy Cinemeta data is removed only after a committed migration", async () => {
  const legacy = new Map([
    ["harbor.cinemeta.meta.v1", JSON.stringify({ "series:tt1": { t: Date.now(), m: metadata() } })],
  ]);
  const failed = fixture({ legacy, persist: false });
  const loader = async () => {
    throw Error("unexpected fetch");
  };
  assert.equal((await failed.withMetaCache("series", "tt1", loader)).videos.length, 1400);
  assert.equal(legacy.size, 1);
  assert.equal(failed.records.size, 0);
  const committed = fixture({ legacy });
  assert.equal((await committed.withMetaCache("series", "tt1", loader)).videos.length, 1400);
  assert.equal(legacy.size, 0);
  assert.equal(committed.records.size, 1);
});

test("Cinemeta placeholder freshness and clearing cannot pin old episode data", async () => {
  const f = fixture();
  let calls = 0;
  const loader = async () => {
    calls++;
    return {
      value: { ...metadata(), videos: [{ name: "TBA", released: "2020-01-01" }] },
      cacheable: true,
    };
  };
  await f.withMetaCache("series", "tt1", loader);
  f.advance(2 * MEDIA_TTL.recent);
  await f.withMetaCache("series", "tt1", loader);
  assert.equal(calls, 2);
  f.legacy.set("harbor.cinemeta.meta.v1", "{}");
  await f.clear();
  assert.equal(f.records.size, 0);
  assert.equal(f.legacy.size, 0);
  await f.withMetaCache("series", "tt1", loader);
  assert.equal(calls, 3);
});
