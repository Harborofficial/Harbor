// @ts-expect-error Node test types are outside the browser tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are outside the browser tsconfig.
import test from "node:test";
// @ts-expect-error Node test types are outside the browser tsconfig.
import { readFileSync } from "node:fs";
import ts from "typescript";

type Provider = "trakt" | "simkl" | "publicmetadb";
type Item = Record<string, any>;

function loadProviderDismiss() {
  const deleted: string[] = [];
  const fail = new Set<Provider>();
  const fetchFail = new Set<Provider>();
  const items: Record<Provider, Item[]> = { trakt: [], simkl: [], publicmetadb: [] };
  const mocks = {
    "@/lib/trakt/playback": {
      deleteTraktPlayback: async (id: string) => {
        deleted.push(`trakt:${id}`);
        return !fail.has("trakt");
      },
      fetchTraktPlaybackItems: async () => {
        if (fetchFail.has("trakt")) throw new Error("offline");
        return items.trakt;
      },
    },
    "@/lib/simkl/playback": {
      deleteSimklPlayback: async (id: string) => {
        deleted.push(`simkl:${id}`);
        return !fail.has("simkl");
      },
      fetchSimklPlaybackItems: async () => {
        if (fetchFail.has("simkl")) throw new Error("offline");
        return items.simkl;
      },
    },
    "@/lib/publicmetadb/playback": {
      fetchPublicMetaDbPlaybackItems: async () => {
        if (fetchFail.has("publicmetadb")) throw new Error("offline");
        return items.publicmetadb;
      },
    },
    "@/lib/publicmetadb/scrobble": {
      pmdbDeleteResume: async (id: string) => {
        deleted.push(`publicmetadb:${id}`);
        return !fail.has("publicmetadb");
      },
    },
    "@/lib/trakt/session": { getSession: () => ({}), subscribeSession: () => () => {} },
    "@/lib/simkl/session": { getSession: () => ({}), subscribeSession: () => () => {} },
    "@/lib/publicmetadb/session": {
      isAuthenticated: () => true,
      subscribeSession: () => () => {},
    },
    "@/lib/active-profile-id": { activeProfileId: () => "test-profile" },
  };
  const code = ts.transpileModule(
    readFileSync(new URL("../src/lib/cw-provider-dismiss.ts", import.meta.url), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  const storage = new Map<string, string>();
  const localStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  };
  const exports: Record<string, any> = {};
  new Function("require", "exports", "localStorage", code)(
    (name: string) => mocks[name as keyof typeof mocks],
    exports,
    localStorage,
  );
  return {
    clearProviderPlayback: exports.clearProviderPlayback,
    flushProviderDismissQueue: exports.flushProviderDismissQueue,
    deleted,
    fail,
    fetchFail,
    items,
    storage,
  };
}

function item(overrides: Item = {}): Item {
  return {
    _id: "tt-test",
    type: "series",
    name: "Test",
    removed: false,
    temp: false,
    _ctime: "2026-01-01T00:00:00Z",
    _mtime: "2026-01-01T00:00:00Z",
    state: { season: 1, episode: 2, timeOffset: 300, duration: 1000 },
    ...overrides,
  };
}

test("clears stored playback ids for every enabled provider", async () => {
  const h = loadProviderDismiss();
  const target = item({ external: "trakt", providerPlaybackIds: { trakt: "t1" } });
  h.items.simkl = [item({ external: "simkl", providerPlaybackIds: { simkl: "s1" } })];

  const result = await h.clearProviderPlayback(target, ["trakt", "simkl"]);

  assert.deepEqual(result, { failed: [] });
  assert.deepEqual(h.deleted, ["trakt:t1", "simkl:s1"]);
});

test("finds a provider playback when an older cached item has no stored id", async () => {
  const h = loadProviderDismiss();
  h.items.trakt = [item({ external: "trakt", providerPlaybackIds: { trakt: "t2" } })];

  const result = await h.clearProviderPlayback(item(), ["trakt"]);

  assert.deepEqual(result, { failed: [] });
  assert.deepEqual(h.deleted, ["trakt:t2"]);
});

test("finds a provider playback when the sources use different content ids", async () => {
  const h = loadProviderDismiss();
  h.items.trakt = [
    item({
      _id: "tmdb:tv:99",
      altIds: ["tt-test"],
      external: "trakt",
      providerPlaybackIds: { trakt: "t-by-alias" },
    }),
  ];

  const result = await h.clearProviderPlayback(item(), ["trakt"]);

  assert.deepEqual(result, { failed: [] });
  assert.deepEqual(h.deleted, ["trakt:t-by-alias"]);
});

test("does not clear a different episode of the same show", async () => {
  const h = loadProviderDismiss();
  h.items.trakt = [
    item({
      state: { season: 1, episode: 3, timeOffset: 300, duration: 1000 },
      external: "trakt",
      providerPlaybackIds: { trakt: "wrong" },
    }),
  ];

  const result = await h.clearProviderPlayback(item(), ["trakt"]);

  assert.deepEqual(result, { failed: [] });
  assert.deepEqual(h.deleted, []);
});

test("ignores a deduped member from a different episode", async () => {
  const h = loadProviderDismiss();
  const target = item({
    external: "trakt",
    providerPlaybackIds: { trakt: "current" },
    cwMembers: [
      item({
        state: { season: 1, episode: 3, timeOffset: 300, duration: 1000 },
        external: "trakt",
        providerPlaybackIds: { trakt: "other" },
      }),
    ],
  });

  const result = await h.clearProviderPlayback(target, ["trakt"]);

  assert.deepEqual(result, { failed: [] });
  assert.deepEqual(h.deleted, ["trakt:current"]);
});

test("uses a same-episode provider id from a title merged under another id", async () => {
  const h = loadProviderDismiss();
  const target = item({ external: "simkl" });
  target.cwMembers = [
    item({
      _id: "tmdb:tv:123",
      external: "trakt",
      providerPlaybackIds: { trakt: "merged" },
    }),
  ];

  const result = await h.clearProviderPlayback(target, ["trakt"]);

  assert.deepEqual(result, { failed: [] });
  assert.deepEqual(h.deleted, ["trakt:merged"]);
});

test("reports a provider failure without throwing", async () => {
  const h = loadProviderDismiss();
  h.fail.add("trakt");

  const result = await h.clearProviderPlayback(
    item({ external: "trakt", providerPlaybackIds: { trakt: "t3" } }),
    ["trakt"],
  );

  assert.deepEqual(result, { failed: ["trakt"] });
});

test("queues a failed provider clear and retries it", async () => {
  const h = loadProviderDismiss();
  h.items.trakt = [
    item({
      external: "trakt",
      providerPlaybackIds: { trakt: "retry" },
      state: { season: 1, episode: 2, timeOffset: 300, duration: 1000 },
    }),
  ];
  h.fail.add("trakt");
  await h.clearProviderPlayback(
    item({ external: "trakt", providerPlaybackIds: { trakt: "retry" } }),
    ["trakt"],
  );
  assert.deepEqual(h.deleted, ["trakt:retry"]);
  assert.ok(h.storage.get("harbor.cw.provider-clear.v1.test-profile"));

  h.fail.delete("trakt");
  await h.flushProviderDismissQueue();

  assert.deepEqual(h.deleted, ["trakt:retry", "trakt:retry"]);
  assert.equal(h.storage.get("harbor.cw.provider-clear.v1.test-profile"), undefined);
});

test("cancels a retry when the user has resumed watching", async () => {
  const h = loadProviderDismiss();
  h.fail.add("trakt");
  await h.clearProviderPlayback(
    item({
      external: "trakt",
      providerPlaybackIds: { trakt: "resumed" },
      state: {
        season: 1,
        episode: 2,
        timeOffset: 300,
        duration: 1000,
        lastWatched: "2020-01-01T00:00:00Z",
      },
    }),
    ["trakt"],
  );
  h.fail.delete("trakt");
  h.items.trakt = [
    item({
      external: "trakt",
      providerPlaybackIds: { trakt: "resumed" },
      state: {
        season: 1,
        episode: 2,
        timeOffset: 2000,
        duration: 3000,
        lastWatched: "2030-01-01T00:00:00Z",
      },
    }),
  ];

  await h.flushProviderDismissQueue();

  assert.deepEqual(h.deleted, ["trakt:resumed"]);
  assert.equal(h.storage.get("harbor.cw.provider-clear.v1.test-profile"), undefined);
});

test("keeps a retry queued when the provider state cannot be checked", async () => {
  const h = loadProviderDismiss();
  h.fail.add("trakt");
  await h.clearProviderPlayback(
    item({ external: "trakt", providerPlaybackIds: { trakt: "offline" } }),
    ["trakt"],
  );
  h.fail.delete("trakt");
  h.fetchFail.add("trakt");

  await h.flushProviderDismissQueue();

  assert.deepEqual(h.deleted, ["trakt:offline"]);
  assert.ok(h.storage.get("harbor.cw.provider-clear.v1.test-profile"));
});

test("drops a retry when the provider no longer has that playback id", async () => {
  const h = loadProviderDismiss();
  h.fail.add("trakt");
  await h.clearProviderPlayback(
    item({ external: "trakt", providerPlaybackIds: { trakt: "gone" } }),
    ["trakt"],
  );
  h.fail.delete("trakt");

  await h.flushProviderDismissQueue();

  assert.deepEqual(h.deleted, ["trakt:gone"]);
  assert.equal(h.storage.get("harbor.cw.provider-clear.v1.test-profile"), undefined);
});
