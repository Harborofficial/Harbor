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
  const fetchError = new Map<Provider, Error>();
  const fetchCalls = new Map<Provider, number>();
  const retryAfter = new Map<Provider, number>();
  const rateLimited = new Set<Provider>();
  const complete = new Map<Provider, boolean>([
    ["trakt", true],
    ["simkl", true],
    ["publicmetadb", true],
  ]);
  const items: Record<Provider, Item[]> = { trakt: [], simkl: [], publicmetadb: [] };
  const sessions: Record<Provider, unknown> = {
    trakt: { username: "alice" },
    simkl: { username: "alice" },
    publicmetadb: { username: "alice" },
  };
  let profile = "test-profile";
  let simklBlocked = false;
  let gate: Promise<void> | null = null;
  let releaseGate: (() => void) | null = null;
  let deleteGate: Promise<void> | null = null;
  let releaseDeleteGate: (() => void) | null = null;
  const waitForGate = () => gate ?? Promise.resolve();
  const waitForDeleteGate = () => deleteGate ?? Promise.resolve();
  const countFetch = (provider: Provider) => {
    fetchCalls.set(provider, (fetchCalls.get(provider) ?? 0) + 1);
  };
  const deleteOutcome = (provider: Provider, id: string) => {
    deleted.push(`${provider}:${id}`);
    const retryAfterMs = fail.has(provider) ? retryAfter.get(provider) : undefined;
    return {
      ok: !fail.has(provider),
      ...(retryAfterMs != null ? { retryAfterMs } : {}),
      ...(fail.has(provider) && rateLimited.has(provider) ? { rateLimited: true } : {}),
    };
  };
  const snapshot = (provider: Provider) => ({
    items: items[provider],
    complete: complete.get(provider) ?? true,
  });
  const mocks = {
    "@/lib/trakt/playback": {
      deleteTraktPlayback: async (id: string) => {
        await waitForDeleteGate();
        return deleteOutcome("trakt", id);
      },
      fetchTraktPlaybackSnapshot: async () => {
        countFetch("trakt");
        await waitForGate();
        if (fetchError.has("trakt")) throw fetchError.get("trakt");
        if (fetchFail.has("trakt")) throw new Error("offline");
        return snapshot("trakt");
      },
    },
    "@/lib/simkl/playback": {
      deleteSimklPlayback: async (id: string) => {
        await waitForDeleteGate();
        return deleteOutcome("simkl", id);
      },
      fetchSimklPlaybackSnapshot: async () => {
        countFetch("simkl");
        await waitForGate();
        if (fetchError.has("simkl")) throw fetchError.get("simkl");
        if (fetchFail.has("simkl")) throw new Error("offline");
        return snapshot("simkl");
      },
    },
    "@/lib/publicmetadb/playback": {
      fetchPublicMetaDbPlaybackSnapshot: async () => {
        countFetch("publicmetadb");
        await waitForGate();
        if (fetchError.has("publicmetadb")) throw fetchError.get("publicmetadb");
        if (fetchFail.has("publicmetadb")) throw new Error("offline");
        return snapshot("publicmetadb");
      },
    },
    "@/lib/publicmetadb/scrobble": {
      pmdbDeleteResumeOutcome: async (id: string) => {
        await waitForDeleteGate();
        return deleteOutcome("publicmetadb", id);
      },
    },
    "@/lib/simkl/client": { isSimklBlocked: () => simklBlocked },
    "@/lib/trakt/session": { getSession: () => sessions.trakt, subscribeSession: () => () => {} },
    "@/lib/simkl/session": { getSession: () => sessions.simkl, subscribeSession: () => () => {} },
    "@/lib/publicmetadb/session": {
      getSession: () => sessions.publicmetadb,
      subscribeSession: () => () => {},
    },
    "@/lib/active-profile-id": { activeProfileId: () => profile },
    "@/lib/stremio": {
      episodeFromVideoId: (id?: string) => {
        const match = id?.match(/:(\d+):(\d+)$/);
        return match ? { season: +match[1], episode: +match[2] } : null;
      },
    },
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
    queueProviderPlaybackClear: exports.queueProviderPlaybackClear,
    queueProviderDiscovery: exports.queueProviderDiscovery,
    holdFetch() {
      gate = new Promise<void>((resolve) => {
        releaseGate = resolve;
      });
    },
    releaseFetch() {
      gate = null;
      releaseGate?.();
      releaseGate = null;
    },
    holdDelete() {
      deleteGate = new Promise<void>((resolve) => {
        releaseDeleteGate = resolve;
      });
    },
    releaseDelete() {
      deleteGate = null;
      releaseDeleteGate?.();
      releaseDeleteGate = null;
    },
    sessions,
    setProfile(id: string) {
      profile = id;
    },
    setSimklBlocked(value: boolean) {
      simklBlocked = value;
    },
    complete,
    retryAfter,
    rateLimited,
    fetchCalls,
    deleted,
    fail,
    fetchFail,
    fetchError,
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

/** A playback the provider currently reports, as the fresh lookup sees it. */
function providerItem(id: string, overrides: Item = {}): Item {
  return item({ external: "trakt", providerPlaybackIds: { trakt: id }, ...overrides });
}

const queueKey = (profile = "test-profile") => `harbor.cw.provider-clear.v1.${profile}`;

function storedQueue(h: ReturnType<typeof loadProviderDismiss>, profile = "test-profile"): Item[] {
  return JSON.parse(h.storage.get(queueKey(profile)) ?? "[]");
}

async function queueFailedClear(
  h: ReturnType<typeof loadProviderDismiss>,
  id: string,
  state: Item = item().state,
) {
  h.items.trakt = [providerItem(id, { state })];
  h.fail.add("trakt");
  await h.clearProviderPlayback(
    item({ external: "trakt", providerPlaybackIds: { trakt: id }, state }),
    ["trakt"],
  );
  h.fail.delete("trakt");
}

test("clears the playback each provider reports", async () => {
  const h = loadProviderDismiss();
  const target = item({ external: "trakt", providerPlaybackIds: { trakt: "t1" } });
  h.items.trakt = [providerItem("t1")];
  h.items.simkl = [item({ external: "simkl", providerPlaybackIds: { simkl: "s1" } })];

  const result = await h.clearProviderPlayback(target, ["trakt", "simkl"]);

  assert.deepEqual(result, { failed: [] });
  assert.deepEqual(h.deleted, ["trakt:t1", "simkl:s1"]);
});

test("finds a provider playback when an older cached item has no stored id", async () => {
  const h = loadProviderDismiss();
  h.items.trakt = [providerItem("t2")];

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
    providerItem("wrong", {
      state: { season: 1, episode: 3, timeOffset: 300, duration: 1000 },
    }),
  ];

  const result = await h.clearProviderPlayback(item(), ["trakt"]);

  assert.deepEqual(result, { failed: [] });
  assert.deepEqual(h.deleted, []);
});

test("an episodic card that cannot name its episode never clears", async () => {
  for (const state of [
    { timeOffset: 300, duration: 1000 },
    { season: 1, timeOffset: 300, duration: 1000 },
  ]) {
    const h = loadProviderDismiss();
    const target = item({
      external: "trakt",
      providerPlaybackIds: { trakt: "unverified-episode" },
      state,
    });
    h.items.trakt = [providerItem("unverified-episode")];

    const result = await h.clearProviderPlayback(target, ["trakt"]);

    assert.deepEqual(result, { failed: [] });
    assert.deepEqual(h.deleted, [], `no delete for state ${JSON.stringify(state)}`);
  }
});

test("a card advanced past its stored id clears only the displayed episode", async () => {
  const h = loadProviderDismiss();
  const advanced = item({
    external: "trakt",
    providerPlaybackIds: { trakt: "old-episode" },
    state: { season: 3, episode: 2, timeOffset: 300, duration: 1000 },
  });
  h.items.trakt = [
    providerItem("old-episode", {
      state: { season: 2, episode: 5, timeOffset: 300, duration: 1000 },
    }),
    providerItem("current-episode", {
      state: { season: 3, episode: 2, timeOffset: 300, duration: 1000 },
    }),
  ];

  const result = await h.clearProviderPlayback(advanced, ["trakt"]);

  assert.deepEqual(result, { failed: [] });
  assert.deepEqual(h.deleted, ["trakt:current-episode"], "the stale id is never used");
});

test("a stale grouped member cannot select an older provider record", async () => {
  const h = loadProviderDismiss();
  const card = item({
    external: "trakt",
    state: { season: 3, episode: 2, timeOffset: 300, duration: 1000 },
    cwMembers: [
      item({
        _id: "tmdb:tv:9",
        external: "trakt",
        state: { season: 2, episode: 5, timeOffset: 300, duration: 1000 },
      }),
    ],
  });
  h.items.trakt = [
    providerItem("old-S2E5", {
      _id: "tmdb:tv:9",
      state: { season: 2, episode: 5, timeOffset: 300, duration: 1000 },
    }),
    providerItem("correct-S3E2", {
      state: { season: 3, episode: 2, timeOffset: 300, duration: 1000 },
    }),
  ];

  const result = await h.clearProviderPlayback(card, ["trakt"]);

  assert.deepEqual(result, { failed: [] });
  assert.deepEqual(h.deleted, ["trakt:correct-S3E2"], "the member's episode never wins");
});

test("a movie without episode coordinates still clears its playback", async () => {
  const h = loadProviderDismiss();
  const movie = item({
    type: "movie",
    external: "trakt",
    providerPlaybackIds: { trakt: "movie-id" },
    state: { timeOffset: 300, duration: 1000 },
  });
  h.items.trakt = [
    providerItem("movie-id", { type: "movie", state: { timeOffset: 300, duration: 1000 } }),
  ];

  const result = await h.clearProviderPlayback(movie, ["trakt"]);

  assert.deepEqual(result, { failed: [] });
  assert.deepEqual(h.deleted, ["trakt:movie-id"]);
});

test("resolves a native anime card's episode from its video id", async () => {
  const h = loadProviderDismiss();
  const card = item({
    _id: "tt-anime",
    external: "trakt",
    providerPlaybackIds: { trakt: "anime" },
    state: { timeOffset: 300, duration: 1000, video_id: "kitsu:1234:5" },
  });
  // The middle segment is the Kitsu entry, not season 1234.
  h.items.trakt = [
    providerItem("anime", {
      _id: "tt-anime",
      state: { season: 1, episode: 5, timeOffset: 300, duration: 1000 },
    }),
  ];

  const result = await h.clearProviderPlayback(card, ["trakt"]);

  assert.deepEqual(result, { failed: [] });
  assert.deepEqual(h.deleted, ["trakt:anime"]);
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
  h.items.trakt = [
    providerItem("current"),
    providerItem("other", {
      state: { season: 1, episode: 3, timeOffset: 300, duration: 1000 },
    }),
  ];

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
  h.items.trakt = [
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
  h.items.trakt = [providerItem("t3")];
  h.fail.add("trakt");

  const result = await h.clearProviderPlayback(
    item({ external: "trakt", providerPlaybackIds: { trakt: "t3" } }),
    ["trakt"],
  );

  assert.deepEqual(result, { failed: ["trakt"] });
});

test("queues a failed provider clear and retries it", async () => {
  const h = loadProviderDismiss();
  h.items.trakt = [providerItem("retry")];
  h.fail.add("trakt");
  await h.clearProviderPlayback(
    item({ external: "trakt", providerPlaybackIds: { trakt: "retry" } }),
    ["trakt"],
  );
  assert.deepEqual(h.deleted, ["trakt:retry"]);
  assert.equal(storedQueue(h).length, 1);
  assert.equal(storedQueue(h)[0].account, "alice");
  assert.deepEqual(storedQueue(h)[0].match.ids, ["tt-test"]);

  h.fail.delete("trakt");
  await h.flushProviderDismissQueue();

  assert.deepEqual(h.deleted, ["trakt:retry", "trakt:retry"]);
  assert.equal(h.storage.get(queueKey()), undefined);
});

test("does not queue a clear when the account cannot be identified", async () => {
  const h = loadProviderDismiss();
  h.sessions.trakt = {};
  h.items.trakt = [providerItem("no-account")];
  h.fail.add("trakt");

  const result = await h.clearProviderPlayback(
    item({ external: "trakt", providerPlaybackIds: { trakt: "no-account" } }),
    ["trakt"],
  );

  assert.deepEqual(result, { failed: ["trakt"] });
  assert.equal(h.storage.get(queueKey()), undefined);
});

test("queues a discovery entry when the snapshot read fails, then clears it", async () => {
  const h = loadProviderDismiss();
  h.fetchFail.add("trakt");
  h.items.trakt = [providerItem("discovered")];

  const result = await h.clearProviderPlayback(
    item({ external: "trakt", providerPlaybackIds: { trakt: "discovered" } }),
    ["trakt"],
  );

  assert.deepEqual(result, { failed: ["trakt"] });
  const entry = storedQueue(h)[0];
  assert.ok(entry.match, "the match is stored for the retry");
  assert.equal(entry.id, undefined, "no unverified id is stored");

  h.fetchFail.delete("trakt");
  await h.flushProviderDismissQueue();

  assert.deepEqual(h.deleted, ["trakt:discovered"]);
  assert.equal(h.storage.get(queueKey()), undefined);
});

test("keeps an entry when the provider list is incomplete", async () => {
  const h = loadProviderDismiss();
  await queueFailedClear(h, "incomplete");
  h.complete.set("trakt", false);
  h.items.trakt = [];

  await h.flushProviderDismissQueue();

  assert.deepEqual(h.deleted, ["trakt:incomplete"], "only the failed first attempt ran");
  assert.equal(
    storedQueue(h).length,
    1,
    "no candidate from a truncated list is not proof of absence",
  );
});

test("clears a candidate found inside an incomplete list", async () => {
  const h = loadProviderDismiss();
  await queueFailedClear(h, "found");
  h.complete.set("trakt", false);

  await h.flushProviderDismissQueue();

  assert.deepEqual(h.deleted, ["trakt:found", "trakt:found"]);
  assert.equal(h.storage.get(queueKey()), undefined);
});

test("drops an entry after the unverifiable-absence TTL", async () => {
  const h = loadProviderDismiss();
  const realNow = Date.now;
  const start = realNow();
  Date.now = () => start;
  try {
    await queueFailedClear(h, "stale");
  } finally {
    Date.now = realNow;
  }
  h.complete.set("trakt", false);
  h.items.trakt = [];
  const later = start + 8 * 24 * 60 * 60_000;
  const afterRestore = Date.now;
  Date.now = () => later;
  try {
    await h.flushProviderDismissQueue();
  } finally {
    Date.now = afterRestore;
  }

  assert.deepEqual(h.deleted, ["trakt:stale"], "only the failed first attempt ran");
  assert.equal(h.storage.get(queueKey()), undefined, "the entry expires without a delete");
});

test("drops a legacy id-only entry without deleting", async () => {
  const h = loadProviderDismiss();
  h.storage.set(
    queueKey(),
    JSON.stringify([
      {
        provider: "trakt",
        id: "legacy",
        attempts: 0,
        nextAt: 0,
        addedAt: Date.now(),
      },
    ]),
  );

  await h.flushProviderDismissQueue();

  assert.deepEqual(h.deleted, []);
  assert.equal(h.storage.get(queueKey()), undefined);
});

test("shares one DELETE between entries that resolve to the same record", async () => {
  const h = loadProviderDismiss();
  h.items.trakt = [providerItem("shared")];
  const origin = { key: queueKey(), account: "alice" };
  const first = {
    type: "series" as const,
    ids: ["tt-test"],
    season: 1,
    episode: 2,
  };
  const second = {
    type: "series" as const,
    ids: ["tmdb:tv:9", "tt-test"],
    season: 1,
    episode: 2,
  };
  h.queueProviderPlaybackClear("trakt", "shared", first, undefined, origin);
  h.queueProviderPlaybackClear("trakt", "shared", second, undefined, origin);

  await h.flushProviderDismissQueue();

  assert.deepEqual(h.deleted, ["trakt:shared"], "one DELETE for both entries");
  assert.equal(h.storage.get(queueKey()), undefined);
});

test("a shared DELETE failure keeps both entries", async () => {
  const h = loadProviderDismiss();
  h.items.trakt = [providerItem("shared-fail")];
  h.fail.add("trakt");
  const origin = { key: queueKey(), account: "alice" };
  h.queueProviderPlaybackClear(
    "trakt",
    "shared-fail",
    { type: "series", ids: ["tt-test"], season: 1, episode: 2 },
    undefined,
    origin,
  );
  h.queueProviderPlaybackClear(
    "trakt",
    "shared-fail",
    { type: "series", ids: ["tmdb:tv:9", "tt-test"], season: 1, episode: 2 },
    undefined,
    origin,
  );

  await h.flushProviderDismissQueue();

  assert.deepEqual(h.deleted, ["trakt:shared-fail"]);
  assert.equal(storedQueue(h).length, 2, "a failed shared delete is not reported as cleared");
});

test("honors Retry-After on a failed delete", async () => {
  const h = loadProviderDismiss();
  h.items.trakt = [providerItem("rate")];
  h.fail.add("trakt");
  h.retryAfter.set("trakt", 7 * 60_000);
  const before = Date.now();
  await h.clearProviderPlayback(
    item({ external: "trakt", providerPlaybackIds: { trakt: "rate" } }),
    ["trakt"],
  );

  const entry = storedQueue(h)[0];
  assert.ok(entry.nextAt >= before + 7 * 60_000, "the retry waits out Retry-After");
});

test("does not fetch while the provider is cooling", async () => {
  const h = loadProviderDismiss();
  await queueFailedClear(h, "cool");
  h.fetchError.set(
    "trakt",
    Object.assign(new Error("rate limited"), { retryAt: Date.now() + 7 * 60_000 }),
  );
  h.items.trakt = [];
  await h.flushProviderDismissQueue();
  const callsAfterFirst = h.fetchCalls.get("trakt") ?? 0;

  await h.flushProviderDismissQueue();

  assert.equal(h.fetchCalls.get("trakt"), callsAfterFirst, "forced flush respects the cooldown");
});

test("does not fetch when Simkl reports its own block", async () => {
  const h = loadProviderDismiss();
  h.complete.set("simkl", true);
  h.fail.add("simkl");
  h.items.simkl = [item({ external: "simkl", providerPlaybackIds: { simkl: "s-blocked" } })];
  await h.clearProviderPlayback(
    item({ external: "simkl", providerPlaybackIds: { simkl: "s-blocked" } }),
    ["simkl"],
  );
  h.setSimklBlocked(true);
  const calls = h.fetchCalls.get("simkl") ?? 0;

  await h.flushProviderDismissQueue();

  assert.equal(h.fetchCalls.get("simkl"), calls, "the Simkl client's block is reused");
});

test("cancels a retry when the user has resumed watching", async () => {
  const h = loadProviderDismiss();
  h.items.trakt = [
    providerItem("resumed", {
      state: {
        season: 1,
        episode: 2,
        timeOffset: 300,
        duration: 1000,
        lastWatched: "2020-01-01T00:00:00Z",
      },
    }),
  ];
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
    providerItem("resumed", {
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
  assert.equal(h.storage.get(queueKey()), undefined);
});

test("keeps a retry queued when the provider state cannot be checked", async () => {
  const h = loadProviderDismiss();
  await queueFailedClear(h, "offline");
  h.fetchFail.add("trakt");

  await h.flushProviderDismissQueue();

  assert.deepEqual(h.deleted, ["trakt:offline"]);
  assert.equal(storedQueue(h).length, 1);
});

test("keeps a clear re-queued while the flush is in flight", async () => {
  const h = loadProviderDismiss();
  await queueFailedClear(h, "dup");

  h.holdFetch();
  const flushing = h.flushProviderDismissQueue();
  await new Promise((resolve) => setTimeout(resolve, 5));
  const stored = storedQueue(h)[0];
  h.queueProviderPlaybackClear(
    "trakt",
    "dup",
    stored.match,
    { timeOffset: 900 },
    {
      key: queueKey(),
      account: "alice",
    },
  );
  h.releaseFetch();
  await flushing;

  assert.equal(storedQueue(h).length, 1, "the newer request keeps its retry");
  assert.deepEqual(h.deleted, ["trakt:dup", "trakt:dup"]);
});

test("does not delete after the provider session changes mid-flush", async () => {
  const h = loadProviderDismiss();
  await queueFailedClear(h, "session");

  h.holdFetch();
  const flushing = h.flushProviderDismissQueue();
  h.sessions.trakt = { username: "bob" };
  h.releaseFetch();
  await flushing;

  assert.deepEqual(h.deleted, ["trakt:session"], "only the failed first attempt ran");
  assert.equal(storedQueue(h).length, 1, "the retry waits for the original session");
});

test("does not delete when the session changes during an immediate lookup", async () => {
  const h = loadProviderDismiss();
  h.items.trakt = [providerItem("alice-S1E2")];

  h.holdFetch();
  const clearing = h.clearProviderPlayback(
    item({ external: "trakt", providerPlaybackIds: { trakt: "alice-S1E2" } }),
    ["trakt"],
  );
  h.sessions.trakt = { username: "bob" };
  h.releaseFetch();

  const result = await clearing;

  assert.deepEqual(result, { failed: ["trakt"] });
  assert.deepEqual(h.deleted, []);
});

test("defers a queued clear when a different account is connected", async () => {
  const h = loadProviderDismiss();
  await queueFailedClear(h, "alice-clear");

  h.sessions.trakt = { username: "bob" };
  await h.flushProviderDismissQueue();

  assert.deepEqual(h.deleted, ["trakt:alice-clear"], "only the failed attempt under alice ran");
  assert.equal(storedQueue(h).length, 1, "the entry waits for alice instead of being dropped");
});

test("a failed delete queues into the profile that started it", async () => {
  const h = loadProviderDismiss();
  h.items.trakt = [providerItem("race")];
  h.fail.add("trakt");

  h.holdDelete();
  const clearing = h.clearProviderPlayback(
    item({ external: "trakt", providerPlaybackIds: { trakt: "race" } }),
    ["trakt"],
  );
  await new Promise((resolve) => setTimeout(resolve, 5));
  h.setProfile("other-profile");
  h.releaseDelete();

  const result = await clearing;

  assert.deepEqual(result, { failed: ["trakt"] });
  assert.equal(h.storage.get(queueKey("other-profile")), undefined, "no cross-profile queue");
  assert.equal(storedQueue(h).length, 1, "the retry stays with the originating profile");
});

test("a profile switch during a flush cancels the attempt and keeps the origin queue", async () => {
  const h = loadProviderDismiss();
  await queueFailedClear(h, "prof");

  h.holdFetch();
  const flushing = h.flushProviderDismissQueue();
  h.setProfile("other-profile");
  h.releaseFetch();
  await flushing;

  assert.deepEqual(h.deleted, ["trakt:prof"], "only the failed first attempt ran");
  assert.equal(storedQueue(h, "test-profile").length, 1, "the entry waits for its profile");
  assert.equal(h.storage.get(queueKey("other-profile")), undefined, "other queues are untouched");
});

test("a clear re-queued in the same millisecond still survives the flush", async () => {
  const h = loadProviderDismiss();
  const realNow = Date.now;
  const frozen = realNow();
  Date.now = () => frozen;
  try {
    await queueFailedClear(h, "same-ms");
    h.holdFetch();
    const flushing = h.flushProviderDismissQueue();
    const stored = storedQueue(h)[0];
    h.queueProviderPlaybackClear("trakt", "same-ms", stored.match, undefined, {
      key: queueKey(),
      account: "alice",
    });
    h.releaseFetch();
    await flushing;
  } finally {
    Date.now = realNow;
  }

  assert.equal(storedQueue(h).length, 1, "a revision, not a timestamp, keeps the newer request");
});

test("a flush that outlives a profile switch arms the active queue", async () => {
  const h = loadProviderDismiss();
  await queueFailedClear(h, "switch");
  h.storage.set(
    queueKey("other-profile"),
    JSON.stringify([
      {
        provider: "trakt",
        account: "alice",
        attempts: 0,
        nextAt: 0,
        addedAt: 0,
        op: "b",
        match: { type: "series", ids: ["tt-test"], season: 1, episode: 2 },
      },
    ]),
  );

  const timers: number[] = [];
  const globals = globalThis as { window?: unknown };
  globals.window = {
    setTimeout: (_fn: () => void, ms: number) => {
      timers.push(ms);
      return timers.length;
    },
    clearTimeout: () => {},
  };
  try {
    h.holdFetch();
    const flushing = h.flushProviderDismissQueue();
    h.setProfile("other-profile");
    h.releaseFetch();
    await flushing;
  } finally {
    delete globals.window;
  }

  assert.equal(storedQueue(h, "test-profile").length, 1, "the old queue keeps its entry");
  assert.ok(timers.length > 0, "the now-active profile's queue is armed");
});

test("drops a retry when a complete provider list no longer has the record", async () => {
  const h = loadProviderDismiss();
  await queueFailedClear(h, "gone");
  h.items.trakt = [];

  await h.flushProviderDismissQueue();

  assert.deepEqual(h.deleted, ["trakt:gone"], "only the failed first attempt ran");
  assert.equal(h.storage.get(queueKey()), undefined, "a complete list proves absence");
});

test("drops a discovery retry when the complete list has no match", async () => {
  const h = loadProviderDismiss();
  h.fetchFail.add("trakt");
  await h.clearProviderPlayback(
    item({ external: "trakt", providerPlaybackIds: { trakt: "never-there" } }),
    ["trakt"],
  );
  assert.equal(storedQueue(h).length, 1);
  h.fetchFail.delete("trakt");
  h.items.trakt = [];

  await h.flushProviderDismissQueue();

  assert.equal(h.storage.get(queueKey()), undefined);
});

test("keeps separate queue entries for two provider accounts of one profile", async () => {
  const h = loadProviderDismiss();
  h.sessions.trakt = { username: "alice" };
  h.items.trakt = [providerItem("alice-pb")];
  h.fail.add("trakt");
  await h.clearProviderPlayback(
    item({ external: "trakt", providerPlaybackIds: { trakt: "alice-pb" } }),
    ["trakt"],
  );

  h.sessions.trakt = { username: "bob" };
  h.items.trakt = [providerItem("bob-pb")];
  await h.clearProviderPlayback(
    item({ external: "trakt", providerPlaybackIds: { trakt: "bob-pb" } }),
    ["trakt"],
  );
  h.fail.delete("trakt");

  const entries = storedQueue(h);
  assert.equal(entries.length, 2, "the account is part of the queue identity");
  assert.deepEqual(entries.map((entry) => entry.account).sort(), ["alice", "bob"]);
  assert.deepEqual(entries.map((entry) => entry.id).sort(), ["alice-pb", "bob-pb"]);

  h.sessions.trakt = { username: "alice" };
  h.items.trakt = [providerItem("alice-pb")];
  await h.flushProviderDismissQueue();

  assert.deepEqual(h.deleted, ["trakt:alice-pb", "trakt:bob-pb", "trakt:alice-pb"]);
  assert.equal(storedQueue(h).length, 1);
  assert.equal(storedQueue(h)[0].account, "bob");
});

test("deletes every provider record for the displayed episode", async () => {
  const h = loadProviderDismiss();
  h.items.trakt = [providerItem("one"), providerItem("two")];

  const result = await h.clearProviderPlayback(item({ external: "trakt" }), ["trakt"]);

  assert.deepEqual(result, { failed: [] });
  assert.deepEqual(h.deleted, ["trakt:one", "trakt:two"]);
});

test("a retry deletes every provider record for the displayed episode", async () => {
  const h = loadProviderDismiss();
  await queueFailedClear(h, "one");
  h.items.trakt = [providerItem("one"), providerItem("two")];

  await h.flushProviderDismissQueue();

  assert.deepEqual(h.deleted, ["trakt:one", "trakt:one", "trakt:two"]);
  assert.equal(h.storage.get(queueKey()), undefined);
});

test("a rate-limited delete without Retry-After still cools the provider", async () => {
  const h = loadProviderDismiss();
  h.items.trakt = [providerItem("limited-delete")];
  h.fail.add("trakt");
  h.rateLimited.add("trakt");

  const before = Date.now();
  await h.clearProviderPlayback(
    item({ external: "trakt", providerPlaybackIds: { trakt: "limited-delete" } }),
    ["trakt"],
  );

  const entry = storedQueue(h)[0];
  assert.ok(entry.nextAt >= before + 5 * 60_000, "the five-minute fallback applies");

  h.fail.delete("trakt");
  const calls = h.fetchCalls.get("trakt") ?? 0;
  await h.flushProviderDismissQueue();
  assert.equal(h.fetchCalls.get("trakt"), calls, "the cooldown blocks even a forced flush");
});

test("a rate limit without Retry-After cools snapshot reads too", async () => {
  const h = loadProviderDismiss();
  await queueFailedClear(h, "limited-fetch");
  h.fetchError.set("trakt", Object.assign(new Error("rate limited"), { status: 429 }));
  h.items.trakt = [];

  await h.flushProviderDismissQueue();
  const calls = h.fetchCalls.get("trakt") ?? 0;
  await h.flushProviderDismissQueue();

  assert.equal(h.fetchCalls.get("trakt"), calls);
});

test("an account switch between queued entries fetches that account's snapshot", async () => {
  const h = loadProviderDismiss();
  h.sessions.trakt = { username: "alice" };
  h.items.trakt = [providerItem("alice-pb")];
  h.fail.add("trakt");
  await h.clearProviderPlayback(
    item({ external: "trakt", providerPlaybackIds: { trakt: "alice-pb" } }),
    ["trakt"],
  );

  h.sessions.trakt = { username: "bob" };
  h.items.trakt = [providerItem("bob-pb")];
  await h.clearProviderPlayback(
    item({ external: "trakt", providerPlaybackIds: { trakt: "bob-pb" } }),
    ["trakt"],
  );
  h.fail.delete("trakt");

  h.sessions.trakt = { username: "alice" };
  h.items.trakt = [providerItem("alice-pb")];
  h.holdDelete();
  const flushing = h.flushProviderDismissQueue();
  await new Promise((resolve) => setTimeout(resolve, 5));
  // Switch to Bob while Alice's DELETE is in flight; Bob's list is now current.
  h.sessions.trakt = { username: "bob" };
  h.items.trakt = [providerItem("bob-pb")];
  h.releaseDelete();
  await flushing;

  assert.deepEqual(
    h.deleted.slice().sort(),
    ["trakt:alice-pb", "trakt:alice-pb", "trakt:bob-pb", "trakt:bob-pb"].sort(),
    "Bob's entry must not reuse Alice's snapshot",
  );
  assert.equal(h.storage.get(queueKey()), undefined);
});

test("a same-account reauthentication between entries issues a new DELETE", async () => {
  const h = loadProviderDismiss();
  const firstSession = { username: "alice", token: "one" };
  h.sessions.trakt = firstSession;
  h.items.trakt = [providerItem("shared")];
  h.fail.add("trakt");
  await h.clearProviderPlayback(
    item({ external: "trakt", providerPlaybackIds: { trakt: "shared" } }),
    ["trakt"],
  );

  // Reauthentication: same account, replacement session object.
  const secondSession = { username: "alice", token: "two" };
  h.sessions.trakt = secondSession;
  h.queueProviderPlaybackClear(
    "trakt",
    "shared",
    { type: "series", ids: ["tmdb:tv:9", "tt-test"], season: 1, episode: 2 },
    undefined,
    { key: queueKey(), account: "alice" },
  );
  h.fail.delete("trakt");

  h.sessions.trakt = firstSession;
  h.items.trakt = [providerItem("shared")];
  h.holdDelete();
  const flushing = h.flushProviderDismissQueue();
  await new Promise((resolve) => setTimeout(resolve, 5));
  h.sessions.trakt = secondSession;
  h.releaseDelete();
  await flushing;

  assert.deepEqual(
    h.deleted,
    ["trakt:shared", "trakt:shared", "trakt:shared"],
    "the replacement session issues its own DELETE",
  );
  assert.equal(h.storage.get(queueKey()), undefined);
});
