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
  const sessions: Record<Provider, unknown> = { trakt: {}, simkl: {}, publicmetadb: {} };
  let profile = "test-profile";
  let gate: Promise<void> | null = null;
  let releaseGate: (() => void) | null = null;
  const waitForGate = () => gate ?? Promise.resolve();
  let deleteGate: Promise<void> | null = null;
  let releaseDeleteGate: (() => void) | null = null;
  const waitForDeleteGate = () => deleteGate ?? Promise.resolve();
  const mocks = {
    "@/lib/trakt/playback": {
      deleteTraktPlayback: async (id: string) => {
        await waitForDeleteGate();
        deleted.push(`trakt:${id}`);
        return !fail.has("trakt");
      },
      fetchTraktPlaybackItems: async () => {
        await waitForGate();
        if (fetchFail.has("trakt")) throw new Error("offline");
        return items.trakt;
      },
    },
    "@/lib/simkl/playback": {
      deleteSimklPlayback: async (id: string) => {
        await waitForDeleteGate();
        deleted.push(`simkl:${id}`);
        return !fail.has("simkl");
      },
      fetchSimklPlaybackItems: async () => {
        await waitForGate();
        if (fetchFail.has("simkl")) throw new Error("offline");
        return items.simkl;
      },
    },
    "@/lib/publicmetadb/playback": {
      fetchPublicMetaDbPlaybackItems: async () => {
        await waitForGate();
        if (fetchFail.has("publicmetadb")) throw new Error("offline");
        return items.publicmetadb;
      },
    },
    "@/lib/publicmetadb/scrobble": {
      pmdbDeleteResume: async (id: string) => {
        await waitForDeleteGate();
        deleted.push(`publicmetadb:${id}`);
        return !fail.has("publicmetadb");
      },
    },
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

/** A playback the provider currently reports, as the fresh lookup sees it. */
function providerItem(id: string, overrides: Item = {}): Item {
  return item({ external: "trakt", providerPlaybackIds: { trakt: id }, ...overrides });
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
  h.items.trakt = [providerItem("offline")];
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
  h.items.trakt = [providerItem("gone")];
  h.fail.add("trakt");
  await h.clearProviderPlayback(
    item({ external: "trakt", providerPlaybackIds: { trakt: "gone" } }),
    ["trakt"],
  );
  h.fail.delete("trakt");
  h.items.trakt = [];

  await h.flushProviderDismissQueue();

  assert.deepEqual(h.deleted, ["trakt:gone"]);
  assert.equal(h.storage.get("harbor.cw.provider-clear.v1.test-profile"), undefined);
});

const queueKey = (profile = "test-profile") => `harbor.cw.provider-clear.v1.${profile}`;

async function queueFailedClear(h: ReturnType<typeof loadProviderDismiss>, id: string) {
  h.items.trakt = [providerItem(id)];
  h.fail.add("trakt");
  await h.clearProviderPlayback(item({ external: "trakt", providerPlaybackIds: { trakt: id } }), [
    "trakt",
  ]);
  h.fail.delete("trakt");
}

test("keeps a clear re-queued while the flush is in flight", async () => {
  const h = loadProviderDismiss();
  h.items.trakt = [item({ external: "trakt", providerPlaybackIds: { trakt: "dup" } })];
  await queueFailedClear(h, "dup");

  h.holdFetch();
  const flushing = h.flushProviderDismissQueue();
  // The flush is parked on the provider fetch; a second dismissal of the same
  // playback now owns the key.
  await new Promise((resolve) => setTimeout(resolve, 5));
  h.queueProviderPlaybackClear("trakt", "dup", { timeOffset: 900 });
  h.releaseFetch();
  await flushing;

  assert.ok(h.storage.get(queueKey()), "the newer request keeps its retry");
  assert.deepEqual(h.deleted, ["trakt:dup", "trakt:dup"]);
});

test("does not delete after the provider session changes mid-flush", async () => {
  const h = loadProviderDismiss();
  h.items.trakt = [item({ external: "trakt", providerPlaybackIds: { trakt: "session" } })];
  await queueFailedClear(h, "session");

  h.holdFetch();
  const flushing = h.flushProviderDismissQueue();
  h.sessions.trakt = { other: true };
  h.releaseFetch();
  await flushing;

  assert.deepEqual(h.deleted, ["trakt:session"], "only the failed first attempt ran");
  assert.ok(h.storage.get(queueKey()), "the retry waits for the original session");
});

test("does not delete when the session changes during an immediate lookup", async () => {
  const h = loadProviderDismiss();
  h.sessions.trakt = { username: "alice" };
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
  assert.deepEqual(
    h.deleted,
    [],
    "the earlier lookup result must not be deleted into another session",
  );
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
  // Let the lookup finish and the DELETE start, then switch profiles under it.
  await new Promise((resolve) => setTimeout(resolve, 5));
  h.setProfile("other-profile");
  h.releaseDelete();

  const result = await clearing;

  assert.deepEqual(result, { failed: ["trakt"] });
  assert.equal(h.storage.get(queueKey("other-profile")), undefined, "no cross-profile queue");
  assert.ok(
    h.storage.get(queueKey("test-profile")),
    "the retry stays with the originating profile",
  );
});

test("finishes the queue of the profile that started the flush", async () => {
  const h = loadProviderDismiss();
  h.items.trakt = [item({ external: "trakt", providerPlaybackIds: { trakt: "prof" } })];
  await queueFailedClear(h, "prof");

  h.holdFetch();
  const flushing = h.flushProviderDismissQueue();
  h.setProfile("other-profile");
  h.releaseFetch();
  await flushing;

  assert.deepEqual(h.deleted, ["trakt:prof", "trakt:prof"]);
  assert.equal(h.storage.get(queueKey("test-profile")), undefined, "the original queue is drained");
  assert.equal(h.storage.get(queueKey("other-profile")), undefined, "other queues are untouched");
});

test("a clear re-queued in the same millisecond still survives the flush", async () => {
  const h = loadProviderDismiss();
  const realNow = Date.now;
  const frozen = realNow();
  Date.now = () => frozen;
  try {
    h.items.trakt = [item({ external: "trakt", providerPlaybackIds: { trakt: "same-ms" } })];
    await queueFailedClear(h, "same-ms");

    h.holdFetch();
    const flushing = h.flushProviderDismissQueue();
    h.queueProviderPlaybackClear("trakt", "same-ms");
    h.releaseFetch();
    await flushing;
  } finally {
    Date.now = realNow;
  }

  assert.ok(h.storage.get(queueKey()), "a revision, not a timestamp, keeps the newer request");
});

test("does not clear a queued id that belongs to another account", async () => {
  const h = loadProviderDismiss();
  h.sessions.trakt = { username: "alice" };
  h.items.trakt = [item({ external: "trakt", providerPlaybackIds: { trakt: "alice-clear" } })];
  await queueFailedClear(h, "alice-clear");

  h.sessions.trakt = { username: "bob" };
  await h.flushProviderDismissQueue();

  assert.deepEqual(h.deleted, ["trakt:alice-clear"], "only the failed attempt under alice ran");
  assert.equal(h.storage.get(queueKey()), undefined, "the id is dropped instead of hitting bob");
});

test("defers a queued id when the current account cannot be identified", async () => {
  const h = loadProviderDismiss();
  h.sessions.trakt = { username: "alice" };
  await queueFailedClear(h, "unverifiable");

  h.sessions.trakt = {}; // signed in, but the provider reports no username
  await h.flushProviderDismissQueue();

  assert.deepEqual(h.deleted, ["trakt:unverifiable"], "only the failed attempt ran");
  assert.ok(h.storage.get(queueKey()), "the retry waits until ownership can be checked");
});

test("a flush that outlives a profile switch arms the active queue", async () => {
  const h = loadProviderDismiss();
  h.items.trakt = [item({ external: "trakt", providerPlaybackIds: { trakt: "switch" } })];
  await queueFailedClear(h, "switch");
  h.storage.set(
    queueKey("other-profile"),
    JSON.stringify([
      { provider: "trakt", id: "b-pending", attempts: 0, nextAt: 0, addedAt: 0, op: "b" },
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

  assert.equal(h.storage.get(queueKey("test-profile")), undefined, "the old queue is drained");
  assert.ok(timers.length > 0, "the now-active profile's queue is armed");
});
