import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";

function load(file, dependencies, globals = {}) {
  const source = readFileSync(new URL("../" + file, import.meta.url), "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    setTimeout,
    clearTimeout,
    queueMicrotask,
    AbortController,
    AbortSignal: { timeout: () => ({}) },
    ...globals,
    require: (name) => {
      assert.ok(name in dependencies, "unmocked dependency " + name);
      return dependencies[name];
    },
  });
  return module.exports;
}

const errors = load("src/lib/anilist/errors.ts", {});

function jsonResponse(data, status = 200) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: () => null },
    text: async () => JSON.stringify(data),
    json: async () => data,
  };
}

function limited(retryAfter) {
  return {
    status: 429,
    ok: false,
    headers: {
      get: (name) => (name.toLowerCase() === "retry-after" ? retryAfter : null),
    },
    text: async () => "rate limited",
    json: async () => ({}),
  };
}

function clientFixture({ token = null, responses }) {
  const calls = [];
  const client = load(
    "src/lib/anilist/client.ts",
    {
      "./config": { ANILIST_GRAPHQL_URL: "https://anilist.invalid" },
      "./session": { getSession: () => (token ? { accessToken: token } : null) },
      "@/lib/safe-fetch": {
        safeFetch: async () => {
          const response = responses.shift();
          calls.push(response);
          return response;
        },
      },
      "./errors": errors,
    },
    {
      // The authenticated retry waits; tests must not.
      setTimeout: (fn) => {
        fn();
        return 0;
      },
    },
  );
  return { client, calls };
}

test("an anonymous 429 opens a cooldown and never retries", async () => {
  const { client, calls } = clientFixture({
    responses: [limited("60"), jsonResponse({ data: { ok: true } })],
  });
  await assert.rejects(client.anilistRequest("query"), (error) => error.status === 429);
  assert.equal(calls.length, 1);
  await assert.rejects(client.anilistRequest("query"), /anonymous rate limit cooldown/);
  assert.equal(calls.length, 1);
});

test("skipAuth uses the anonymous cooldown even when a session token exists", async () => {
  const { client, calls } = clientFixture({
    token: "session-token",
    responses: [limited("60"), jsonResponse({ data: { ok: true } })],
  });
  await assert.rejects(
    client.anilistRequest("query", {}, undefined, true),
    (error) => error.status === 429,
  );
  await assert.rejects(
    client.anilistRequest("query", {}, undefined, true),
    /anonymous rate limit cooldown/,
  );
  assert.equal(calls.length, 1);
});

test("an authenticated 429 gets one bounded retry", async () => {
  const { client, calls } = clientFixture({
    token: "session-token",
    responses: [limited("0"), jsonResponse({ data: { ok: true } })],
  });
  assert.deepEqual(await client.anilistRequest("query"), { ok: true });
  assert.equal(calls.length, 2);
});

test("a second authenticated 429 is returned instead of retried forever", async () => {
  const { client, calls } = clientFixture({
    token: "session-token",
    responses: [limited("0"), limited("0"), jsonResponse({ data: { ok: true } })],
  });
  await assert.rejects(client.anilistRequest("query"), (error) => error.status === 429);
  assert.equal(calls.length, 2);
});

const cache = {
  lruSet: (map, key, value, max) => {
    map.set(key, value);
    while (map.size > max) map.delete(map.keys().next().value);
  },
};

function mediaDetailsFixture(anilistRequest) {
  return load("src/lib/anilist/media-details.ts", {
    "./client": { anilistRequest },
    "@/lib/providers/anime-mapping": { kitsuToAnilist: async () => null },
    "@/lib/cache": cache,
    "@/lib/maintenance": { registerEvictable: () => {} },
  });
}

test("a failed media-details request is retried instead of cached", async () => {
  let calls = 0;
  const details = mediaDetailsFixture(async () => {
    calls += 1;
    if (calls === 1) throw new Error("429");
    return { Media: { id: 7, title: { native: null, romaji: "Test", english: "Test" } } };
  });
  assert.equal(await details.fetchAnilistMediaDetails(7), null);
  const result = await details.fetchAnilistMediaDetails(7);
  assert.equal(result?.anilistId, 7);
  assert.equal(calls, 2);
});

test("a genuine missing media entry is still negatively cached", async () => {
  let calls = 0;
  const details = mediaDetailsFixture(async () => {
    calls += 1;
    return { Media: null };
  });
  assert.equal(await details.fetchAnilistMediaDetails(9), null);
  assert.equal(await details.fetchAnilistMediaDetails(9), null);
  assert.equal(calls, 1);
});
