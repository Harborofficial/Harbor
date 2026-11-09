import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  loadNuvioState,
  saveNuvioState,
  getNuvioAccountId,
  refreshNuvioSession,
  nuvioFetch,
} from "../src/lib/nuvio/nuvio-client";
import {
  readCachedNuvioLibrary,
  writeCachedNuvioLibrary,
  clearNuvioLibraryCache,
  readNuvioCursor,
  writeNuvioCursor,
  recordTombstone,
  readTombstones,
  writePendingUpserts,
  readPendingUpserts,
  readPendingDeletes,
  writePendingDeletes,
  flushNuvioLibraryMutations,
  pullNuvioLibrarySnapshot,
} from "../src/lib/nuvio/nuvio-library";
import {
  rememberNuvioPin,
  verifyNuvioPinLocally,
  clearAllNuvioPinCaches,
  markNuvioProfileUnlocked,
  isNuvioProfileUnlocked,
  clearNuvioSessionUnlocks,
  refuseNuvioProfileSelect,
  setActiveNuvioProfile,
} from "../src/lib/nuvio/nuvio-profiles";
import {
  resolveNuvioProfileIndex,
  readCachedWatchProgress,
  writeCachedWatchProgress,
  clearCachedWatchProgress,
  deleteWatchProgressFromNuvio,
  pullWatchProgressFromNuvio,
  pullWatchedItemsFromNuvio,
  reconcileNuvioWatched,
} from "../src/lib/nuvio/nuvio-sync";
import {
  fetchNuvioPlaybackItems,
  readCachedNuvioPlaybackItems,
  writeCachedNuvioPlaybackItems,
  clearCachedPlaybackItems,
} from "../src/lib/nuvio/nuvio-playback";
import { saveResumeMs, readResumeEntry, clearResume, clearAllNuvioResume } from "../src/lib/resume";
import { saveLocalCw, listLocalCw, clearAllNuvioLocalCw } from "../src/lib/local-cw";
import { signOutNuvio } from "../src/lib/nuvio/nuvio-auth";

// Mock localStorage in node test environment
const mockStorage = new Map<string, string>();
globalThis.localStorage = {
  getItem: (key: string) => mockStorage.get(key) ?? null,
  setItem: (key: string, val: string) => {
    mockStorage.set(key, String(val));
  },
  removeItem: (key: string) => {
    mockStorage.delete(key);
  },
  clear: () => {
    mockStorage.clear();
  },
  key: (i: number) => Array.from(mockStorage.keys())[i] ?? null,
  get length() {
    return mockStorage.size;
  },
} as unknown as Storage;

// Mock window event dispatching
if (typeof globalThis.window === "undefined") {
  (globalThis as unknown as Record<string, unknown>).window = {
    dispatchEvent: () => true,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
}

test("Issue 1: Player scrobble hook is mounted in use-player-media pipeline and slot 0 maps correctly", () => {
  const playerMediaSrc = readFileSync(
    new URL("../src/views/player/hooks/use-player-media.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    playerMediaSrc,
    /import\s*\{\s*useNuvioScrobble\s*\}\s*from\s*["']@\/lib\/nuvio\/nuvio-scrobble-hook["']/,
    "useNuvioScrobble must be imported in use-player-media.ts",
  );
  assert.match(
    playerMediaSrc,
    /useNuvioScrobble\(\{\s*src,\s*snap,\s*season,\s*episode\s*\}\)/,
    "useNuvioScrobble must be mounted alongside Trakt, Simkl, and PMDB",
  );

  // Harbor profile 0 maps to Nuvio slot 1 (primary)
  assert.equal(resolveNuvioProfileIndex(0), 1);
  assert.equal(resolveNuvioProfileIndex("0"), 1);
  assert.equal(resolveNuvioProfileIndex(2), 2);
  assert.equal(resolveNuvioProfileIndex("nuvio-3"), 3);
});

test("Issue 2: Library cache, queues, cursors, and tombstones are strictly scoped by accountId", () => {
  mockStorage.clear();

  // User A logs in
  saveNuvioState({
    session: {
      access_token: "tok-a",
      refresh_token: "ref-a",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      token_type: "bearer",
      user: { id: "user-aaa-111" },
    },
    profiles: [{ id: "p1", user_id: "user-aaa-111", profile_index: 1, name: "User A" }],
    activeProfileIndex: 1,
    lastSyncedAt: Date.now(),
  });
  assert.equal(getNuvioAccountId(), "user-aaa-111");

  writeCachedNuvioLibrary(1, [
    { content_id: "tt001", content_type: "movie", title: "User A Movie" },
  ]);
  writeNuvioCursor(1, 42);
  recordTombstone(1, "tt002", "movie");
  writePendingUpserts(1, [{ content_id: "tt003", content_type: "movie", title: "Pending A" }]);

  const itemsA = readCachedNuvioLibrary(1);
  assert.equal(itemsA.length, 1);
  assert.equal(itemsA[0].content_id, "tt001");
  assert.equal(readNuvioCursor(1), 42);
  assert.ok(readTombstones(1).has("tt002"));
  assert.equal(readPendingUpserts(1).length, 1);

  // User B logs in
  saveNuvioState({
    session: {
      access_token: "tok-b",
      refresh_token: "ref-b",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      token_type: "bearer",
      user: { id: "user-bbb-222" },
    },
    profiles: [{ id: "p2", user_id: "user-bbb-222", profile_index: 1, name: "User B" }],
    activeProfileIndex: 1,
    lastSyncedAt: Date.now(),
  });
  assert.equal(getNuvioAccountId(), "user-bbb-222");

  // User B must NOT see User A's data
  const itemsB = readCachedNuvioLibrary(1);
  assert.equal(itemsB.length, 0, "User B must not see User A's library items");
  assert.equal(readNuvioCursor(1), null, "User B must not see User A's cursor");
  assert.equal(readTombstones(1).size, 0, "User B must not see User A's tombstones");
  assert.equal(readPendingUpserts(1).length, 0, "User B must not inherit User A's pending upserts");

  // clearNuvioLibraryCache purges all keys
  clearNuvioLibraryCache();
  for (const k of mockStorage.keys()) {
    assert.ok(!k.startsWith("harbor.nuvio.library."), `Stale library key remaining: ${k}`);
  }
});

test("Issue 3: PIN cache is account-scoped and purged on signout", async () => {
  mockStorage.clear();
  clearNuvioSessionUnlocks();

  // User A logs in
  saveNuvioState({
    session: {
      access_token: "tok-a",
      refresh_token: "ref-a",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      token_type: "bearer",
      user: { id: "user-aaa-111" },
    },
    profiles: [
      { id: "p1", user_id: "user-aaa-111", profile_index: 1, name: "Profile 1" },
      { id: "p2", user_id: "user-aaa-111", profile_index: 2, name: "Profile 2", pin_enabled: true },
    ],
    activeProfileIndex: 1,
    lastSyncedAt: Date.now(),
  });

  await rememberNuvioPin(2, "1234");
  const unlockedLocallyA = await verifyNuvioPinLocally(2, "1234");
  assert.equal(unlockedLocallyA, true);

  // User B logs in
  saveNuvioState({
    session: {
      access_token: "tok-b",
      refresh_token: "ref-b",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      token_type: "bearer",
      user: { id: "user-bbb-222" },
    },
    profiles: [
      { id: "pb1", user_id: "user-bbb-222", profile_index: 1, name: "User B Main" },
      {
        id: "pb2",
        user_id: "user-bbb-222",
        profile_index: 2,
        name: "User B Kid",
        pin_enabled: true,
      },
    ],
    activeProfileIndex: 1,
    lastSyncedAt: Date.now(),
  });

  // User B profile 2 must NOT be unlocked by User A's PIN
  const unlockedLocallyB = await verifyNuvioPinLocally(2, "1234");
  assert.equal(
    unlockedLocallyB,
    false,
    "User B's profile 2 must not be unlocked with User A's cached PIN",
  );

  // Sign out clears all PIN caches and session unlocks
  clearAllNuvioPinCaches();
  for (const k of mockStorage.keys()) {
    assert.ok(!k.startsWith("harbor.nuvio.pin_cache."), `Stale pin key remaining: ${k}`);
  }
});

test("Issue 4: In-flight refresh aborts if user signs out or switches accounts", async () => {
  mockStorage.clear();

  saveNuvioState({
    session: {
      access_token: "old-tok",
      refresh_token: "old-ref",
      expires_at: 100,
      token_type: "bearer",
      user: { id: "user-original" },
    },
    profiles: [],
    activeProfileIndex: 1,
    lastSyncedAt: null,
  });

  // Intercept fetch to simulate sign-out happening while refresh is in flight
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    // User logs out while fetch is pending!
    saveNuvioState({
      session: null,
      profiles: [],
      activeProfileIndex: 1,
      lastSyncedAt: null,
    });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        access_token: "new-tok-zombie",
        refresh_token: "new-ref-zombie",
        expires_in: 3600,
        token_type: "bearer",
        user: { id: "user-original" },
      }),
    } as unknown as Response;
  };

  try {
    const res = await refreshNuvioSession();
    assert.equal(res, null, "refreshNuvioSession must abort if session was cleared during fetch");
    assert.equal(loadNuvioState().session, null, "Must not resurrect cleared session in state");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Issue 5: Settings profile switch successfully unlocks and switches locked profiles", () => {
  mockStorage.clear();
  clearNuvioSessionUnlocks();

  const profile2 = {
    id: "p2",
    user_id: "user-1",
    profile_index: 2,
    name: "Locked Profile",
    pin_enabled: true,
  };

  saveNuvioState({
    session: {
      access_token: "tok",
      refresh_token: "ref",
      expires_at: 999999999,
      token_type: "bearer",
      user: { id: "user-1" },
    },
    profiles: [{ id: "p1", user_id: "user-1", profile_index: 1, name: "Main Profile" }, profile2],
    activeProfileIndex: 1,
    lastSyncedAt: null,
  });

  // Attempting to select without unlock should be refused
  const refused = refuseNuvioProfileSelect(profile2, new Set());
  assert.equal(refused, true);

  // Settings PIN flow unlocks slot and marks it
  markNuvioProfileUnlocked(2);
  assert.equal(isNuvioProfileUnlocked(2), true);

  // Now switching succeeds
  const switched = setActiveNuvioProfile(2, { unlocked: true });
  assert.equal(switched, true);
  assert.equal(loadNuvioState().activeProfileIndex, 2);
});

// ============================================================================
// Review 2 Follow-Up Regression Checks (6 Additional Hardened Gates)
// ============================================================================

test("Review 2 Issue 1: Private resume strictly isolates owner writes, reads, and clears", () => {
  mockStorage.clear();

  // 1. A write without explicit owner only enters shared KEY, never entering private scope
  saveResumeMs("tt100", 45000, 1, 1);
  const sharedRaw = mockStorage.get("harbor.resume");
  assert.ok(
    sharedRaw && sharedRaw.includes("tt100|s1e1"),
    "Unowned write must enter shared resume",
  );
  assert.equal(
    mockStorage.has("harbor.resume.private.v1.alice"),
    false,
    "Unowned write must never enter active private profile",
  );

  // 2. An explicit owner write lands in both shared and private scopes
  saveResumeMs("tt101", 90000, 1, 1, undefined, undefined, undefined, "alice");
  const privateAlice = mockStorage.get("harbor.resume.private.v1.alice");
  assert.ok(
    privateAlice && privateAlice.includes("tt101|s1e1"),
    "Owner write must enter private profile",
  );

  // 3. Clear with acknowledged option clears only active private scope without deleting shared progress
  mockStorage.set(
    "harbor.profiles.v1",
    JSON.stringify({
      activeId: "alice",
      profiles: [
        { id: "main", isPrimary: true },
        { id: "alice", shareStremioWith: "main" },
      ],
    }),
  );
  mockStorage.set("harbor.settings.shared", JSON.stringify({ cwPerProfile: true }));
  clearResume("tt101", 1, 1, { acknowledged: true });
  assert.equal(
    mockStorage.get("harbor.resume.private.v1.alice")?.includes("tt101|s1e1"),
    false,
    "Private clear must remove from private scope",
  );
  assert.ok(
    mockStorage.get("harbor.resume")?.includes("tt101|s1e1"),
    "Private clear must not delete from shared progress",
  );
});

test("Review 2 Issue 2: Nuvio watch progress and playback items are strictly scoped by accountId", () => {
  mockStorage.clear();

  // User A writes watch progress & playback items
  writeCachedWatchProgress(
    1,
    [{ content_id: "ttA", profile_id: 1, position_seconds: 120 } as any],
    "user-A",
  );
  writeCachedNuvioPlaybackItems(1, [{ _id: "ttA", name: "Title A" } as any], "user-A");

  // User B reads their own slot 1
  const bProgress = readCachedWatchProgress(1, "user-B");
  const bItems = readCachedNuvioPlaybackItems(1, "user-B");
  assert.equal(bProgress.length, 0, "User B must not see User A's watch progress");
  assert.equal(bItems.length, 0, "User B must not see User A's playback items");

  // Sign out clears both caches
  clearCachedWatchProgress();
  clearCachedPlaybackItems();
  for (const k of mockStorage.keys()) {
    assert.ok(
      !k.startsWith("harbor.nuvio.watch_progress."),
      "Watch progress cache must be cleared",
    );
    assert.ok(
      !k.startsWith("harbor.nuvio.playback_items."),
      "Playback items cache must be cleared",
    );
  }
});

test("Review 2 Issue 3: Switching to Nuvio provider dynamically updates Continue Watching", () => {
  const cwSource = readFileSync(new URL("../src/lib/feed/external-cw.ts", import.meta.url), "utf8");
  assert.match(
    cwSource,
    /sourceMask\.nuvio\s*=\s*isNuvioProviderActive\(\)/,
    "onProfileChange and onSessionChange must dynamically refresh sourceMask.nuvio without requiring app reload",
  );
  assert.match(
    cwSource,
    /window\.addEventListener\(["']harbor:account-provider-changed["'],\s*onProfileChange\)/,
    "harbor:account-provider-changed must be wired to onProfileChange to update provider CW state",
  );
  assert.match(
    cwSource,
    /mask\.nuvio\s*!==\s*undefined\s*\?\s*mask\.nuvio\s*:\s*isNuvioProviderActive\(\)/,
    "setExternalCwSources must fall back to dynamic isNuvioProviderActive() instead of stale sourceMask",
  );
});

test("Review 2 Issue 4: Failed library delete retains item in pending queue", async () => {
  mockStorage.clear();

  saveNuvioState({
    session: {
      access_token: "tok",
      refresh_token: "ref",
      expires_at: 9999999,
      token_type: "bearer",
      user: { id: "u-del" },
    },
    profiles: [],
    activeProfileIndex: 1,
    lastSyncedAt: null,
  });

  writePendingDeletes(1, [{ content_id: "tt-fail-delete", content_type: "movie" }], "u-del");
  assert.equal(readPendingDeletes(1, "u-del").length, 1);

  // Simulate both RPC and direct table DELETE failing with HTTP 500
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    ({
      ok: false,
      status: 500,
      json: async () => ({ message: "Internal server error" }),
    }) as unknown as Response;

  try {
    const success = await flushNuvioLibraryMutations(1);
    assert.equal(success, false, "Flush must return false on failed network delete");

    const remaining = readPendingDeletes(1, "u-del");
    assert.equal(remaining.length, 1, "Failed delete must be retained in pending queue");
    assert.equal(remaining[0].content_id, "tt-fail-delete");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Review 2 Issue 5: In-flight library flush aborts if user switches accounts", async () => {
  mockStorage.clear();

  saveNuvioState({
    session: {
      access_token: "tok-A",
      refresh_token: "ref-A",
      expires_at: 9999999,
      token_type: "bearer",
      user: { id: "user-A" },
    },
    profiles: [],
    activeProfileIndex: 1,
    lastSyncedAt: null,
  });

  writePendingDeletes(1, [{ content_id: "tt-user-A-item", content_type: "movie" }], "user-A");

  // Intercept fetch: while User A's flush is running, User B signs in
  const originalFetch = globalThis.fetch;
  let requestsMadeWithB = 0;
  globalThis.fetch = async (_url, init) => {
    // Switch to User B mid-flight
    saveNuvioState({
      session: {
        access_token: "tok-B",
        refresh_token: "ref-B",
        expires_at: 9999999,
        token_type: "bearer",
        user: { id: "user-B" },
      },
      profiles: [],
      activeProfileIndex: 1,
      lastSyncedAt: null,
    });
    const authHeader = (init?.headers as Record<string, string>)?.["Authorization"] || "";
    if (authHeader.includes("tok-B")) {
      requestsMadeWithB++;
    }
    return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
  };

  try {
    const flushed = await flushNuvioLibraryMutations(1);
    assert.equal(flushed, false, "Flush must abort when account switches mid-flight");
    assert.equal(
      requestsMadeWithB,
      0,
      "User A's mutations must never be dispatched with User B's token",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Review 2 Issue 6: Session refresh race guards against late 401 and late success", async () => {
  mockStorage.clear();

  // Scenario A: Late 401 must not wipe a newer login to the same account
  saveNuvioState({
    session: {
      access_token: "tok-1",
      refresh_token: "ref-1",
      expires_at: 100,
      token_type: "bearer",
      user: { id: "u-same" },
    },
    profiles: [],
    activeProfileIndex: 1,
    lastSyncedAt: null,
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    // While refresh is in flight, user logs in with newer credentials (ref-2)
    saveNuvioState({
      session: {
        access_token: "tok-2",
        refresh_token: "ref-2",
        expires_at: 99999,
        token_type: "bearer",
        user: { id: "u-same" },
      },
      profiles: [],
      activeProfileIndex: 1,
      lastSyncedAt: null,
    });
    return { ok: false, status: 401 } as unknown as Response;
  };

  try {
    const res = await refreshNuvioSession();
    assert.equal(res, null);
    const state = loadNuvioState();
    assert.ok(state.session !== null, "Late 401 must not wipe newer session");
    assert.equal(state.session?.refresh_token, "ref-2", "Newer session must be preserved");
  } finally {
    globalThis.fetch = originalFetch;
  }

  // Scenario B: Late success must not overwrite a newer login to the same account
  globalThis.fetch = async () => {
    // User renewed with ref-3 while ref-2 was refreshing
    saveNuvioState({
      session: {
        access_token: "tok-3",
        refresh_token: "ref-3",
        expires_at: 99999,
        token_type: "bearer",
        user: { id: "u-same" },
      },
      profiles: [],
      activeProfileIndex: 1,
      lastSyncedAt: null,
    });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        access_token: "stale-tok",
        refresh_token: "stale-ref",
        expires_in: 3600,
      }),
    } as unknown as Response;
  };

  try {
    const res = await refreshNuvioSession();
    assert.equal(res, null, "Late success must be rejected when newer session exists");
    assert.equal(
      loadNuvioState().session?.refresh_token,
      "ref-3",
      "Newer session token must not be overwritten",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ============================================================================
// Review 3 Follow-Up Regression Checks (3 Critical Production Gates)
// ============================================================================

test("Review 3 Issue 1: Local Continue Watching and resume entries are account-scoped and purged on sign-out", () => {
  mockStorage.clear();

  // User A logs in
  saveNuvioState({
    session: {
      access_token: "tok-A",
      refresh_token: "ref-A",
      expires_at: 9999999,
      token_type: "bearer",
      user: { id: "user-A" },
    },
    profiles: [{ id: "p1", user_id: "user-A", profile_index: 1, name: "Profile 1" }],
    activeProfileIndex: 1,
    lastSyncedAt: Date.now(),
  });

  saveLocalCw(
    {
      id: "tt-user-a-title",
      type: "movie",
      name: "User A Title",
      positionMs: 300000,
      durationMs: 3600000,
      t: Date.now(),
    },
    "nuvio-1",
  );
  saveResumeMs(
    "tt-user-a-title",
    300000,
    undefined,
    undefined,
    undefined,
    0.08,
    "nuvio",
    "nuvio-1",
  );

  const listA = listLocalCw(true, "nuvio-1");
  assert.equal(listA.length, 1);
  assert.equal(listA[0].id, "tt-user-a-title");

  // User B logs in
  saveNuvioState({
    session: {
      access_token: "tok-B",
      refresh_token: "ref-B",
      expires_at: 9999999,
      token_type: "bearer",
      user: { id: "user-B" },
    },
    profiles: [{ id: "pb1", user_id: "user-B", profile_index: 1, name: "Profile 1" }],
    activeProfileIndex: 1,
    lastSyncedAt: Date.now(),
  });

  // User B must NOT see User A's local CW or resume data
  const listB = listLocalCw(true, "nuvio-1");
  assert.equal(listB.length, 0, "User B must not see User A's local continue watching entries");

  // Sign out clears all Nuvio local CW and resume entries
  clearAllNuvioLocalCw();
  clearAllNuvioResume();

  for (const k of mockStorage.keys()) {
    assert.ok(!k.includes(".nuvio-1"), `Stale nuvio-1 key must not remain after signout: ${k}`);
  }
});

test("Review 3 Issue 2: Library mutations queued during an in-flight flush are preserved", async () => {
  mockStorage.clear();

  saveNuvioState({
    session: {
      access_token: "tok",
      refresh_token: "ref",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      token_type: "bearer",
      user: { id: "u-flush" },
    },
    profiles: [],
    activeProfileIndex: 1,
    lastSyncedAt: null,
  });

  // 1. Initial pending delete item1
  writePendingDeletes(1, [{ content_id: "tt-del-1", content_type: "movie" }], "u-flush");
  // Initial pending upsert item1
  writePendingUpserts(
    1,
    [{ content_id: "tt-up-1", content_type: "movie", name: "Movie 1" }],
    "u-flush",
  );

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url: any) => {
    const urlStr = String(url || "");
    // While request is in-flight, a second delete and upsert are queued by user!
    if (urlStr.includes("delete")) {
      const curDeletes = readPendingDeletes(1, "u-flush");
      if (!curDeletes.some((d) => d.content_id === "tt-del-2")) {
        writePendingDeletes(
          1,
          [...curDeletes, { content_id: "tt-del-2", content_type: "movie" }],
          "u-flush",
        );
      }
    }
    if (urlStr.includes("sync_push_library")) {
      const curUpserts = readPendingUpserts(1, "u-flush");
      if (!curUpserts.some((u) => u.content_id === "tt-up-2")) {
        writePendingUpserts(
          1,
          [...curUpserts, { content_id: "tt-up-2", content_type: "movie", name: "Movie 2" }],
          "u-flush",
        );
      }
    }

    return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
  };

  try {
    const success = await flushNuvioLibraryMutations(1);
    assert.equal(success, true);

    const remainingDeletes = readPendingDeletes(1, "u-flush");
    assert.equal(remainingDeletes.length, 1, "Delete queued during flush must be preserved");
    assert.equal(remainingDeletes[0].content_id, "tt-del-2");

    const remainingUpserts = readPendingUpserts(1, "u-flush");
    assert.equal(remainingUpserts.length, 1, "Upsert queued during flush must be preserved");
    assert.equal(remainingUpserts[0].content_id, "tt-up-2");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Review 3 Issue 3: Playback deletion updates account-scoped cache key", async () => {
  mockStorage.clear();

  saveNuvioState({
    session: {
      access_token: "tok",
      refresh_token: "ref",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      token_type: "bearer",
      user: { id: "user-acc-1" },
    },
    profiles: [{ id: "p1", user_id: "user-acc-1", profile_index: 1, name: "P1" }],
    activeProfileIndex: 1,
    lastSyncedAt: null,
  });

  // Seed watch progress & playback items in account-scoped cache
  writeCachedWatchProgress(
    1,
    [
      { content_id: "tt-keep", profile_id: 1, position_seconds: 120 } as any,
      { content_id: "tt-del-target", profile_id: 1, position_seconds: 60 } as any,
    ],
    "user-acc-1",
  );
  writeCachedNuvioPlaybackItems(
    1,
    [
      { _id: "tt-keep", name: "Keep Movie" } as any,
      { _id: "tt-del-target", name: "Delete Target" } as any,
    ],
    "user-acc-1",
  );

  // Also seed legacy slot key to verify it is wiped
  mockStorage.set("harbor.nuvio.playback_items.slot.1", JSON.stringify([{ _id: "tt-del-target" }]));

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    ({
      ok: true,
      status: 200,
      json: async () => [],
    }) as unknown as Response;

  try {
    await deleteWatchProgressFromNuvio(1, "tt-del-target");

    const currentCached = readCachedNuvioPlaybackItems(1, "user-acc-1");
    assert.equal(
      currentCached.some((i) => i._id === "tt-del-target"),
      false,
      "Deleted title must be removed from account-scoped playback items cache",
    );
    assert.equal(
      currentCached.some((i) => i._id === "tt-keep"),
      true,
      "Surviving items must remain in account-scoped playback cache",
    );
    assert.equal(
      mockStorage.has("harbor.nuvio.playback_items.slot.1"),
      false,
      "Legacy un-scoped slot key must be purged",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ============================================================================
// Review 4 Follow-Up Regression Checks (2 Critical Production Gates)
// ============================================================================

test("Review 4 Issue 1: Player resume autosave uses effective Nuvio profile, isolates accounts, and survives sign-out cleanup", async () => {
  mockStorage.clear();

  // Set account provider to Nuvio
  mockStorage.set("harbor.account-provider", "nuvio");

  // Account A signs in
  saveNuvioState({
    session: {
      access_token: "tok-A",
      refresh_token: "ref-A",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      token_type: "bearer",
      user: { id: "user-A" },
    },
    profiles: [{ id: "p1", user_id: "user-A", profile_index: 1, name: "Profile 1" }],
    activeProfileIndex: 1,
    lastSyncedAt: Date.now(),
  });

  // The player saves resume position passing a Harbor profile ID (e.g. "default") or undefined
  // simulating useResumeAutosave / usePlayerExit:
  saveResumeMs("tt-movie-a", 150000, undefined, undefined, undefined, 0.5, "nuvio", "default");

  // Verify that shared harbor.resume key was NOT polluted
  assert.equal(
    mockStorage.has("harbor.resume"),
    false,
    "Nuvio playback must never write to shared harbor.resume key",
  );

  // Verify that the entry was stored in the account-scoped and profile-scoped key
  const accAKey = "harbor.resume.private.v1.user-A.nuvio-1";
  assert.ok(mockStorage.has(accAKey), "Must write to account-scoped Nuvio key");
  assert.ok(mockStorage.get(accAKey)?.includes("tt-movie-a"));

  // Verify that readResumeEntry reads the position for an ordinary, non-private profile in Nuvio mode
  const entryA = readResumeEntry("tt-movie-a");
  assert.ok(entryA !== null, "readResumeEntry must find position in Nuvio mode");
  assert.equal(entryA?.ms, 150000);

  // Account A signs out
  await signOutNuvio();

  // Verify that Account A's Nuvio resume cache is wiped
  assert.equal(mockStorage.has(accAKey), false, "Sign-out must purge Nuvio resume data");

  // Account B signs in
  mockStorage.set("harbor.account-provider", "nuvio");
  saveNuvioState({
    session: {
      access_token: "tok-B",
      refresh_token: "ref-B",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      token_type: "bearer",
      user: { id: "user-B" },
    },
    profiles: [{ id: "pb1", user_id: "user-B", profile_index: 1, name: "Profile B1" }],
    activeProfileIndex: 1,
    lastSyncedAt: Date.now(),
  });

  // Account B must NOT see Account A's resume position
  const entryB = readResumeEntry("tt-movie-a");
  assert.equal(entryB, null, "Account B must not see Account A's resume position");

  // Account B saves their own playback
  saveResumeMs("tt-movie-a", 45000, undefined, undefined, undefined, 0.15, "nuvio", "default");
  const accBKey = "harbor.resume.private.v1.user-B.nuvio-1";
  assert.ok(mockStorage.has(accBKey), "Account B writes to their own key");
  assert.equal(readResumeEntry("tt-movie-a")?.ms, 45000);
  assert.equal(mockStorage.has("harbor.resume"), false, "Shared key remains unpolluted");
});

test("Review 4 Issue 2: In-flight library update to the same title preserves the newer version", async () => {
  mockStorage.clear();

  saveNuvioState({
    session: {
      access_token: "tok",
      refresh_token: "ref",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      token_type: "bearer",
      user: { id: "u-same-test" },
    },
    profiles: [],
    activeProfileIndex: 1,
    lastSyncedAt: null,
  });

  // Initial pending upsert: version "Old" of title tt-same
  const oldItem = {
    content_id: "tt-same",
    content_type: "movie",
    name: "Old Title",
    added_at: 1000,
  };
  writePendingUpserts(1, [oldItem], "u-same-test");

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url: any) => {
    const urlStr = String(url || "");
    // While the flush request is in flight sending "Old Title", user updates to "New Title"!
    if (urlStr.includes("sync_push_library")) {
      const newItem = {
        content_id: "tt-same",
        content_type: "movie",
        name: "New Title",
        added_at: 2000,
      };
      writePendingUpserts(1, [newItem], "u-same-test");
    }
    return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
  };

  try {
    const success = await flushNuvioLibraryMutations(1);
    assert.equal(success, true, "Flush must succeed");

    // The pending queue must NOT be empty: "New Title" must be preserved!
    const remaining = readPendingUpserts(1, "u-same-test");
    assert.equal(
      remaining.length,
      1,
      "Newer update to same title must be preserved in pending queue",
    );
    assert.equal(remaining[0].name, "New Title");
    assert.equal(remaining[0].added_at, 2000);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Review 5 Issue 1: In-flight watch progress and library pulls discard responses if user switches accounts or signs out", async () => {
  mockStorage.clear();
  mockStorage.set("harbor.account-provider", "nuvio");

  // Part 1: Watch progress pull under Account A; Account switches to Account B while in-flight
  saveNuvioState({
    session: {
      access_token: "tok-a",
      refresh_token: "ref-a",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      token_type: "bearer",
      user: { id: "user-account-a" },
    },
    profiles: [{ id: "p-a1", name: "Profile A1", profile_index: 1, user_id: "user-account-a" }],
    activeProfileIndex: 1,
    lastSyncedAt: null,
  });

  const originalFetch = globalThis.fetch;
  const simulatedAccountB = {
    session: {
      access_token: "tok-b",
      refresh_token: "ref-b",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      token_type: "bearer",
      user: { id: "user-account-b" },
    },
    profiles: [{ id: "p-b1", name: "Profile B1", profile_index: 1, user_id: "user-account-b" }],
    activeProfileIndex: 1,
    lastSyncedAt: null,
  };

  try {
    globalThis.fetch = async (url: any) => {
      const urlStr = String(url || "");
      // In-flight network request: user switches to Account B!
      saveNuvioState(simulatedAccountB);

      if (urlStr.includes("sync_pull_watch_progress") || urlStr.includes("watch_progress")) {
        return {
          ok: true,
          status: 200,
          json: async () => [
            {
              profile_id: 1,
              content_id: "tt-user-a-secret",
              progress_key: "tt-user-a-secret:1:1",
              season: 1,
              episode: 1,
              duration: 3600,
              time: 1800,
              watched_percentage: 50,
              last_watched: 10000,
            },
          ],
        } as unknown as Response;
      }

      return { ok: true, status: 200, json: async () => [] } as unknown as Response;
    };

    const progressResult = await pullWatchProgressFromNuvio(1);
    assert.deepEqual(
      progressResult,
      [],
      "In-flight watch progress pull must return empty array when account changed",
    );

    // Account B caches must NOT contain Account A's watch progress or playback items
    const accBProgress = readCachedWatchProgress(1, "user-account-b");
    assert.equal(accBProgress.length, 0, "Account B watch progress cache must remain empty");

    const accBPlayback = readCachedNuvioPlaybackItems(1, "user-account-b");
    assert.equal(accBPlayback.length, 0, "Account B playback items cache must remain empty");

    const accBCw = listLocalCw(true, "nuvio-1");
    assert.equal(
      accBCw.some((c) => c.id === "tt-user-a-secret"),
      false,
      "Local CW must not contain Account A title",
    );

    // Part 2: Library snapshot pull under Account A; Account switches to Account B while in-flight
    // Reset back to Account A
    saveNuvioState({
      session: {
        access_token: "tok-a",
        refresh_token: "ref-a",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        token_type: "bearer",
        user: { id: "user-account-a" },
      },
      profiles: [{ id: "p-a1", name: "Profile A1", profile_index: 1, user_id: "user-account-a" }],
      activeProfileIndex: 1,
      lastSyncedAt: null,
    });

    globalThis.fetch = async (url: any) => {
      const urlStr = String(url || "");
      // In-flight network request: switch to Account B
      saveNuvioState(simulatedAccountB);

      if (urlStr.includes("sync_get_library_delta_cursor")) {
        return { ok: true, status: 200, json: async () => 42 } as unknown as Response;
      }

      if (urlStr.includes("sync_pull_library") || urlStr.includes("library_items")) {
        return {
          ok: true,
          status: 200,
          json: async () => [
            {
              id: "lib-a-1",
              profile_id: 1,
              content_id: "tt-user-a-movie",
              content_type: "movie",
              name: "Account A Private Movie",
              added_at: 1000,
            },
          ],
        } as unknown as Response;
      }

      return { ok: true, status: 200, json: async () => [] } as unknown as Response;
    };

    const libraryResult = await pullNuvioLibrarySnapshot(1);
    assert.deepEqual(
      libraryResult,
      [],
      "In-flight library snapshot pull must discard responses when account changed",
    );

    // Account B caches must NOT contain Account A's library items or cursor
    const accBLibrary = readCachedNuvioLibrary(1, "user-account-b");
    assert.equal(accBLibrary.length, 0, "Account B library cache must remain empty");

    const accBCursor = readNuvioCursor(1, "user-account-b");
    assert.equal(accBCursor, null, "Account B cursor must not be set by Account A in-flight pull");

    // Part 3: In-flight pull when user signs out completely
    saveNuvioState({
      session: {
        access_token: "tok-a",
        refresh_token: "ref-a",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        token_type: "bearer",
        user: { id: "user-account-a" },
      },
      profiles: [{ id: "p-a1", name: "Profile A1", profile_index: 1, user_id: "user-account-a" }],
      activeProfileIndex: 1,
      lastSyncedAt: null,
    });

    globalThis.fetch = async () => {
      // In-flight: user logs out!
      signOutNuvio();
      return {
        ok: true,
        status: 200,
        json: async () => [
          {
            profile_id: 1,
            content_id: "tt-late-signout",
            progress_key: "tt-late-signout:1:1",
            duration: 3600,
            time: 1800,
          },
        ],
      } as unknown as Response;
    };

    const signoutProgress = await pullWatchProgressFromNuvio(1);
    assert.deepEqual(signoutProgress, [], "Pull after sign-out must return empty array");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Discarded watch progress pull does not clear the next account's playback cache", async () => {
  mockStorage.clear();
  mockStorage.set("harbor.account-provider", "nuvio");
  const account = (id: string) => ({
    session: {
      access_token: `tok-${id}`,
      refresh_token: `ref-${id}`,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      token_type: "bearer",
      user: { id },
    },
    profiles: [{ id: `p-${id}`, name: id, profile_index: 1, user_id: id }],
    activeProfileIndex: 1,
    lastSyncedAt: null,
  });
  saveNuvioState(account("user-a"));

  const originalFetch = globalThis.fetch;
  let releaseResponse!: (response: Response) => void;
  let notifyStarted!: () => void;
  const response = new Promise<Response>((resolve) => {
    releaseResponse = resolve;
  });
  const started = new Promise<void>((resolve) => {
    notifyStarted = resolve;
  });

  try {
    globalThis.fetch = async (url: any) => {
      if (String(url).includes("sync_pull_watch_progress")) {
        notifyStarted();
        return response;
      }
      return { ok: true, status: 200, json: async () => [] } as unknown as Response;
    };

    const pending = fetchNuvioPlaybackItems(1);
    await started;
    saveNuvioState(account("user-b"));
    writeCachedWatchProgress(
      1,
      [
        {
          content_id: "tt-b-only",
          progress_key: "tt-b-only",
          profile_id: 1,
          progress_seconds: 90,
        } as any,
      ],
      "user-b",
    );
    writeCachedNuvioPlaybackItems(1, [{ _id: "tt-b-only", name: "B only" } as any], "user-b");

    releaseResponse({
      ok: true,
      status: 200,
      json: async () => [
        { content_id: "tt-a-only", progress_key: "tt-a-only", progress_seconds: 90 },
      ],
    } as unknown as Response);

    assert.deepEqual(await pending, []);
    assert.deepEqual(
      readCachedWatchProgress(1, "user-b").map((item) => item.content_id),
      ["tt-b-only"],
    );
    assert.deepEqual(
      readCachedNuvioPlaybackItems(1, "user-b").map((item) => item._id),
      ["tt-b-only"],
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Nuvio watched snapshots page past 1000 and failed reads never prune local state", async () => {
  mockStorage.clear();
  mockStorage.set("harbor.account-provider", "nuvio");
  saveNuvioState({
    session: {
      access_token: "paging-test",
      refresh_token: "paging-refresh",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      token_type: "bearer",
      user: { id: "paging-account" },
    },
    profiles: [{ id: "paging-profile", name: "Main", profile_index: 1, user_id: "paging-account" }],
    activeProfileIndex: 1,
    lastSyncedAt: null,
  });

  const originalFetch = globalThis.fetch;
  let pages = 0;
  try {
    const all = [
      ...Array.from({ length: 1000 }, (_, i) => ({
        content_id: `tt-page-${i}`,
        content_type: "movie",
      })),
      { content_id: "kitsu:12", season: 1, episode: 1001, content_type: "series" },
    ];
    globalThis.fetch = async (url: any) => {
      if (String(url).includes("sync_pull_watched_items")) {
        return { ok: true, status: 200, json: async () => all.slice(0, 1000) } as Response;
      }
      const offset = Number(/[?&]offset=(\d+)/.exec(String(url))?.[1] ?? 0);
      pages++;
      const rows = all.slice(offset, offset + 1000);
      return {
        ok: true,
        status: 200,
        json: async () => rows,
        headers: new Headers({
          "Content-Range": `${offset}-${offset + rows.length - 1}/${all.length}`,
        }),
      } as Response;
    };
    const items = await pullWatchedItemsFromNuvio(1);
    assert.equal(items?.length, 1001, "all pages should be collected");
    assert.equal(pages, 2, "full first page requires a second request");

    const key = "harbor.manualwatched.v1.nuvio.v2.paging-account.slot.1";
    mockStorage.set(key, '["kitsu:12|1|200"]');
    globalThis.fetch = async () =>
      ({
        ok: false,
        status: 503,
        json: async () => ({}),
      }) as Response;
    assert.equal(await pullWatchedItemsFromNuvio(1), null);
    await reconcileNuvioWatched(1);
    assert.equal(mockStorage.get(key), '["kitsu:12|1|200"]');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Nuvio limited watch-progress response preserves cached episodes beyond the first 50", async () => {
  mockStorage.clear();
  mockStorage.set("harbor.account-provider", "nuvio");
  saveNuvioState({
    session: {
      access_token: "limit-test",
      refresh_token: "limit-refresh",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      token_type: "bearer",
      user: { id: "limit-account" },
    },
    profiles: [{ id: "limit-profile", name: "Main", profile_index: 1, user_id: "limit-account" }],
    activeProfileIndex: 1,
    lastSyncedAt: null,
  });
  const cached = Array.from({ length: 60 }, (_, i) => ({
    profile_id: 1,
    content_id: "kitsu:12",
    progress_key: `kitsu:12:1:${i + 1}`,
    progress_seconds: 100,
    duration_seconds: 1000,
    season: 1,
    episode: i + 1,
    updated_at: new Date().toISOString(),
    last_watched: Date.now(),
  }));
  writeCachedWatchProgress(1, cached, "limit-account");
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url: any) => {
      assert.ok(String(url).includes("sync_pull_watch_progress"));
      return {
        ok: true,
        status: 200,
        json: async () => cached.slice(0, 50),
      } as Response;
    };
    const result = await pullWatchProgressFromNuvio(1);
    assert.equal(result.length, 60);
    assert.equal(readCachedWatchProgress(1, "limit-account").length, 60);
    assert.ok(result.some((item) => item.episode === 60));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("simultaneous detail and home watched reconciliation shares one cloud snapshot", async () => {
  mockStorage.clear();
  mockStorage.set("harbor.account-provider", "nuvio");
  saveNuvioState({
    session: {
      access_token: "once-token",
      refresh_token: "once-refresh",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      token_type: "bearer",
      user: { id: "singleflight-account" },
    },
    profiles: [{ id: "p1", name: "Main", profile_index: 1, user_id: "singleflight-account" }],
    activeProfileIndex: 1,
    lastSyncedAt: null,
  });
  const originalFetch = globalThis.fetch;
  let finish!: (response: Response) => void;
  const pending = new Promise<Response>((resolve) => {
    finish = resolve;
  });
  let calls = 0;
  try {
    globalThis.fetch = async () => {
      calls += 1;
      return pending;
    };
    const fromHome = reconcileNuvioWatched();
    const fromDetail = reconcileNuvioWatched();
    assert.strictEqual(fromHome, fromDetail);
    finish({
      ok: true,
      status: 200,
      headers: new Headers({ "Content-Range": "0-0/1" }),
      json: async () => [{ content_id: "tt-one", content_type: "movie" }],
    } as Response);
    await Promise.all([fromHome, fromDetail]);
    assert.equal(calls, 2, "one RPC and one verified table snapshot are shared");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

for (const phase of ["expiry", "401"] as const) {
  test(`Nuvio transport never refreshes or sends another account's payload after a switch during ${phase}`, async () => {
    mockStorage.clear();
    const state = {
      session: {
        access_token: "A-token",
        refresh_token: "A-refresh",
        expires_at: Math.floor(Date.now() / 1000) + (phase === "expiry" ? -1 : 3600),
        token_type: "bearer",
        user: { id: "A" },
      },
      profiles: [],
      activeProfileIndex: 1,
      lastSyncedAt: null,
    };
    saveNuvioState(state);
    const oldFetch = globalThis.fetch;
    let finish!: (response: Response) => void;
    const waiting = new Promise<Response>((resolve) => {
      finish = resolve;
    });
    const calls: string[] = [];
    globalThis.fetch = async (url) => {
      calls.push(String(url));
      return waiting;
    };
    try {
      const request = nuvioFetch("/rest/v1/watched_items", {
        method: "POST",
        body: '{"content_id":"A-only"}',
      });
      saveNuvioState({
        ...state,
        session: {
          ...state.session,
          access_token: "B-token",
          refresh_token: "B-refresh",
          user: { id: "B" },
        },
      });
      finish(
        new Response(
          phase === "expiry"
            ? JSON.stringify({ access_token: "refreshed-A", user: { id: "A" } })
            : "[]",
          { status: phase === "expiry" ? 200 : 401 },
        ),
      );
      await assert.rejects(request, /owner changed/);
      assert.equal(
        calls.length,
        1,
        "no payload send or second-account refresh may follow the switch",
      );
      assert.equal(loadNuvioState().session?.user.id, "B");
    } finally {
      globalThis.fetch = oldFetch;
    }
  });
}
