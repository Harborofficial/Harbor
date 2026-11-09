import "./_localstorage-stub.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  transferPrimaryNuvioProfile,
  markNuvioProfileUnlocked,
  clearNuvioSessionUnlocks,
} from "../src/lib/nuvio/nuvio-profiles";
import {
  swapNuvioProfileCloudData,
  remapPendingChangesProfileId,
  writeCachedWatchProgress,
  writeCachedWatchedItems,
} from "../src/lib/nuvio/nuvio-sync";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const nuvioProfiles = read("../src/lib/nuvio/nuvio-profiles.ts");
const nuvioSync = read("../src/lib/nuvio/nuvio-sync.ts");
const nuvioPlayback = read("../src/lib/nuvio/nuvio-playback.ts");
const editorView = read("../src/components/profile-picker/editor-view.tsx");

const nuvioSnapshotFetch = (
  custom?: (url: string, opts?: any) => Response | null,
): ((url: any, opts?: any) => Promise<Response>) => {
  return async (url: any, opts?: any) => {
    const u = String(url);
    const handled = custom?.(u, opts);
    if (handled) return handled;
    if (u.includes("sync_pull_watched_items") || u.includes("sync_pull_watch_progress")) {
      return new Response("[]", { status: 200 });
    }
    if (u.includes("/rest/v1/watched_items?") || u.includes("/rest/v1/watch_progress?")) {
      return new Response("[]", {
        status: 200,
        headers: new Headers({ "Content-Range": "*/0" }),
      });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };
};

test("nuvio-sync exports shared account-scoped cache key helpers", () => {
  assert.match(
    nuvioSync,
    /export function getWatchProgressKey\(slot:\s*number,\s*accountId\?: string\): string/,
    "must export getWatchProgressKey",
  );
  assert.match(
    nuvioSync,
    /export function getWatchedItemsKey\(slot:\s*number,\s*accountId\?: string\): string/,
    "must export getWatchedItemsKey",
  );
  assert.match(
    nuvioSync,
    /export function getDismissedNextUpStorageKey\s*\(/,
    "must export getDismissedNextUpStorageKey",
  );
  assert.match(
    nuvioSync,
    /export function getNuvioAddonsCacheKey\(slot\?: number,\s*accountId\?: string\): string/,
    "must export getNuvioAddonsCacheKey",
  );
  assert.match(
    nuvioSync,
    /export function getPendingSyncKey\(slot:\s*number,\s*accountId:\s*string\): string/,
    "must export getPendingSyncKey",
  );
});

test("nuvio-playback exports getPlaybackItemsKey", () => {
  assert.match(
    nuvioPlayback,
    /export function getPlaybackItemsKey\(slot:\s*number,\s*accountId\?: string\): string/,
    "must export getPlaybackItemsKey",
  );
});

test("nuvio-profiles exports getPinCacheKey supporting account-scoping", () => {
  assert.match(
    nuvioProfiles,
    /export function getPinCacheKey\(profileIndex:\s*number,\s*accountId\?: string \| null\): string/,
    "must export getPinCacheKey with optional accountId",
  );
});

test("swapNuvioProfileCloudData verifies all destination writes before deleting source data and rolls back on failure", () => {
  // Phase 1 verification with explicit cloud migration
  assert.match(
    nuvioSync,
    /const ok =\s*await migrateCloudPushWatched\(\s*slotB/,
    "must push watched items to slotB and verify result",
  );
  assert.match(
    nuvioSync,
    /const ok =\s*await migrateCloudPushWatched\(\s*slotA/,
    "must push watched items to slotA and verify result",
  );
  assert.match(
    nuvioSync,
    /const ok =\s*await migrateCloudPushProgress\(\s*slotB/,
    "must push watch progress to slotB and verify result",
  );
  assert.match(
    nuvioSync,
    /const ok =\s*await migrateCloudPushProgress\(\s*slotA/,
    "must push watch progress to slotA and verify result",
  );

  // Recovery rollback on write failure
  assert.match(
    nuvioSync,
    /rollbackDestinationWrites/,
    "must implement rollback for destination writes on partial failure",
  );

  // Phase 2: deletes exact source data ONLY after writes succeed
  assert.match(
    nuvioSync,
    /migrateCloudDeleteWatched\(\s*slotA/,
    "must delete source watched items from slotA after confirmation",
  );
  assert.match(
    nuvioSync,
    /migrateCloudDeleteProgress\(\s*slotA/,
    "must delete source watch progress from slotA after confirmation",
  );
});

test("transferPrimaryNuvioProfile handles unavailable PIN credentials explicitly", () => {
  assert.match(
    nuvioProfiles,
    /if \(slot1\.pin_enabled\) \{\s*if \(!pinPlain1 \|\| !pinPlain1\.trim\(\)\) \{/,
    "must explicitly reject transfer if slot 1 PIN is enabled but credentials unavailable",
  );
  assert.match(
    nuvioProfiles,
    /if \(targetSlot\.pin_enabled\) \{\s*if \(!pinPlainTarget \|\| !pinPlainTarget\.trim\(\)\) \{/,
    "must explicitly reject transfer if targetSlot PIN is enabled but credentials unavailable",
  );
  assert.match(
    nuvioProfiles,
    /options\?:\s*\{\s*sourcePin\?: string;\s*targetPin\?: string;\s*\}/,
    "must allow passing credentials explicitly via options",
  );
});

test("transferPrimaryNuvioProfile verifies server-side PIN operations and does not ignore errors", () => {
  assert.match(
    nuvioProfiles,
    /const setRes = await setNuvioPin\(/,
    "must capture setNuvioPin result",
  );
  assert.match(nuvioProfiles, /if \(!setRes\.unlocked\)/, "must check setNuvioPin unlocked status");
  assert.match(
    nuvioProfiles,
    /const clearRes = await clearNuvioPin\(/,
    "must capture clearNuvioPin result",
  );
  assert.match(
    nuvioProfiles,
    /if \(!clearRes\.unlocked\)/,
    "must check clearNuvioPin unlocked status",
  );
});

test("transferPrimaryNuvioProfile migrates account-scoped caches and supports rollback", () => {
  // Uses shared key helpers
  assert.match(nuvioProfiles, /getPlaybackItemsKey\(1,\s*accountId\)/);
  assert.match(nuvioProfiles, /getWatchProgressKey\(1,\s*accountId\)/);
  assert.match(nuvioProfiles, /getWatchedItemsKey\(1,\s*accountId\)/);
  assert.match(nuvioProfiles, /getDismissedNextUpStorageKey\(1,\s*accountId\)/);
  assert.match(nuvioProfiles, /getNuvioAddonsCacheKey\(1,\s*accountId\)/);
  assert.match(nuvioProfiles, /getPendingSyncKey\(1,\s*accountId\)/);

  // Hydrates both slots from the cloud before any mutation
  assert.match(
    nuvioProfiles,
    /pullWatchedItemsFromNuvio\(1, \{ force: true, allowInactiveSlot: true \}\)/,
    "must pull slot 1 watched items with force",
  );
  assert.match(
    nuvioProfiles,
    /pullWatchProgressSnapshotFromNuvio\(targetSlotIndex, accountId\)/,
    "must pull a strict progress snapshot for the target slot",
  );

  // Swaps and rolls back
  assert.match(
    nuvioProfiles,
    /const swapCloudOk = await swapNuvioProfileCloudData\(1, targetSlotIndex\);/,
    "must check swapNuvioProfileCloudData result",
  );
  assert.match(
    nuvioProfiles,
    /if \(!swapCloudOk\)\s*\{\s*throw new Error/,
    "must throw if swapNuvioProfileCloudData returns false",
  );
  assert.match(
    nuvioProfiles,
    /if \(cloudDataSwapped\) \{\s*try \{\s*await swapNuvioProfileCloudData\(1, targetSlotIndex\)/,
    "must rollback cloud data swap if failure occurs after cloud swap",
  );
  assert.match(
    nuvioProfiles,
    /pinMigratedStage === "half" \|\| pinMigratedStage === "done"/,
    "must rollback server-side PIN changes on partial failure",
  );
});

test("transferPrimaryNuvioProfile execution rejects if credentials unavailable", async () => {
  clearNuvioSessionUnlocks();
  localStorage.clear();

  const mockState = {
    session: { access_token: "token-123", user: { id: "acc-test" } },
    profiles: [
      { profile_index: 1, name: "Profile 1", pin_enabled: true },
      { profile_index: 2, name: "Profile 2", pin_enabled: false },
    ],
    activeProfileIndex: 1,
  };
  localStorage.setItem("harbor.account-provider", "nuvio");
  localStorage.setItem("harbor.nuvio.state.v1", JSON.stringify(mockState));
  markNuvioProfileUnlocked(1);
  markNuvioProfileUnlocked(2);

  const ok = await transferPrimaryNuvioProfile(2);
  assert.equal(
    ok,
    false,
    "must return false when slot 1 has pin_enabled but no plaintext PIN available",
  );
});

test("transferPrimaryNuvioProfile execution rolls back caches on server-side PIN rejection", async () => {
  clearNuvioSessionUnlocks();
  localStorage.clear();

  const mockState = {
    session: { access_token: "token-123", user: { id: "acc-test" } },
    profiles: [
      { profile_index: 1, name: "Profile 1", pin_enabled: true },
      { profile_index: 2, name: "Profile 2", pin_enabled: false },
    ],
    activeProfileIndex: 1,
  };
  localStorage.setItem("harbor.account-provider", "nuvio");
  localStorage.setItem("harbor.nuvio.state.v1", JSON.stringify(mockState));
  markNuvioProfileUnlocked(1);
  markNuvioProfileUnlocked(2);

  const initialItems1 = JSON.stringify([{ _id: "item-1" }]);
  const initialItems2 = JSON.stringify([{ _id: "item-2" }]);
  localStorage.setItem("harbor.nuvio.playback_items.acc-test.slot.1", initialItems1);
  localStorage.setItem("harbor.nuvio.playback_items.acc-test.slot.2", initialItems2);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = nuvioSnapshotFetch((u) => {
    if (u.includes("set_profile_pin")) {
      // Backend rejects PIN
      return new Response(JSON.stringify({ unlocked: false, message: "PIN rejected by server" }), {
        status: 200,
      });
    }
    return null;
  });

  try {
    const ok = await transferPrimaryNuvioProfile(2, { sourcePin: "1234" });
    assert.equal(ok, false, "transfer must fail when set_profile_pin returns unlocked: false");

    // Verify rollback restored initial items
    assert.equal(
      localStorage.getItem("harbor.nuvio.playback_items.acc-test.slot.1"),
      initialItems1,
      "slot 1 playback items must be restored after rollback",
    );
    assert.equal(
      localStorage.getItem("harbor.nuvio.playback_items.acc-test.slot.2"),
      initialItems2,
      "slot 2 playback items must be restored after rollback",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("transferPrimaryNuvioProfile execution swaps account-scoped and legacy caches successfully", async () => {
  clearNuvioSessionUnlocks();
  localStorage.clear();

  const mockState = {
    session: { access_token: "token-123", user: { id: "acc-test" } },
    profiles: [
      { profile_index: 1, name: "Profile 1", pin_enabled: false },
      { profile_index: 2, name: "Profile 2", pin_enabled: false },
    ],
    activeProfileIndex: 1,
  };
  localStorage.setItem("harbor.account-provider", "nuvio");
  localStorage.setItem("harbor.nuvio.state.v1", JSON.stringify(mockState));

  const items1 = JSON.stringify([{ _id: "slot1-cw" }]);
  const items2 = JSON.stringify([{ _id: "slot2-cw" }]);
  localStorage.setItem("harbor.nuvio.playback_items.acc-test.slot.1", items1);
  localStorage.setItem("harbor.nuvio.playback_items.acc-test.slot.2", items2);

  const legacy1 = JSON.stringify([{ _id: "legacy1" }]);
  const legacy2 = JSON.stringify([{ _id: "legacy2" }]);
  localStorage.setItem("harbor.nuvio.playback_items.slot.1", legacy1);
  localStorage.setItem("harbor.nuvio.playback_items.slot.2", legacy2);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = nuvioSnapshotFetch();

  try {
    const ok = await transferPrimaryNuvioProfile(2);
    assert.equal(ok, true, "transfer must succeed when all cloud operations succeed");

    // Verify account-scoped playback items were swapped
    assert.equal(
      localStorage.getItem("harbor.nuvio.playback_items.acc-test.slot.1"),
      items2,
      "slot 1 must now hold slot 2 items",
    );
    assert.equal(
      localStorage.getItem("harbor.nuvio.playback_items.acc-test.slot.2"),
      items1,
      "slot 2 must now hold slot 1 items",
    );

    // Verify legacy playback items were swapped
    assert.equal(
      localStorage.getItem("harbor.nuvio.playback_items.slot.1"),
      legacy2,
      "legacy slot 1 must now hold legacy slot 2 items",
    );
    assert.equal(
      localStorage.getItem("harbor.nuvio.playback_items.slot.2"),
      legacy1,
      "legacy slot 2 must now hold legacy slot 1 items",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("swapNuvioProfileCloudData transfers watch history to inactive profile slot without active profile restrictions", async () => {
  clearNuvioSessionUnlocks();
  localStorage.clear();

  const mockState = {
    session: { access_token: "token-123", user: { id: "acc-active-check" } },
    profiles: [
      { profile_index: 1, name: "Profile 1", pin_enabled: false },
      { profile_index: 2, name: "Profile 2", pin_enabled: false },
    ],
    activeProfileIndex: 1, // Slot 1 is active, slot 2 is inactive
  };
  localStorage.setItem("harbor.nuvio.state.v1", JSON.stringify(mockState));

  // Seed cached watched items for slot 1
  writeCachedWatchedItems(
    1,
    [
      {
        content_id: "tt99999",
        season: 1,
        episode: 1,
        watched_at: "2026-01-01T00:00:00Z",
      },
    ],
    "acc-active-check",
  );

  const fetchCalls: { url: string; body?: any }[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url: any, opts?: any) => {
    let body = null;
    try {
      if (opts?.body) body = JSON.parse(opts.body);
    } catch {}
    fetchCalls.push({ url: String(url), body });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

  try {
    const ok = await swapNuvioProfileCloudData(1, 2);
    assert.equal(ok, true, "swapNuvioProfileCloudData must succeed even though slot 2 is inactive");

    // Verify destination push wrote directly to slot 2 without active profile check
    const pushToSlot2 = fetchCalls.find(
      (c) =>
        (c.url.includes("sync_push_watched") && c.body?.p_profile_id === 2) ||
        (c.url.includes("watched_items") && c.body?.profile_id === 2),
    );
    assert.ok(pushToSlot2, "must push watched items directly to target slot 2 in cloud");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("swapNuvioProfileCloudData exact record deletion preserves overlapping series progress", async () => {
  clearNuvioSessionUnlocks();
  localStorage.clear();

  const mockState = {
    session: { access_token: "token-123", user: { id: "acc-overlap" } },
    profiles: [
      { profile_index: 1, name: "Profile 1", pin_enabled: false },
      { profile_index: 2, name: "Profile 2", pin_enabled: false },
    ],
    activeProfileIndex: 1,
  };
  localStorage.setItem("harbor.nuvio.state.v1", JSON.stringify(mockState));

  // Profile 1 is on S1E1, Profile 2 is on S1E2 of the exact same show "tt-overlap-series"
  writeCachedWatchProgress(
    1,
    [
      {
        content_id: "tt-overlap-series",
        season: 1,
        episode: 1,
        progress: 120,
        duration: 2400,
        progress_key: "tt-overlap-series:1:1",
      },
    ],
    "acc-overlap",
  );
  writeCachedWatchProgress(
    2,
    [
      {
        content_id: "tt-overlap-series",
        season: 1,
        episode: 2,
        progress: 300,
        duration: 2400,
        progress_key: "tt-overlap-series:1:2",
      },
    ],
    "acc-overlap",
  );

  const deleteCalls: { url: string; body?: any }[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url: any, opts?: any) => {
    const u = String(url);
    if (opts?.method === "DELETE" || u.includes("delete")) {
      let body = null;
      try {
        if (opts?.body) body = JSON.parse(opts.body);
      } catch {}
      deleteCalls.push({ url: u, body });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

  try {
    const ok = await swapNuvioProfileCloudData(1, 2);
    assert.equal(ok, true, "swap must succeed");

    // Deletion for slot 1 must target exact key or episode=1, NOT wipe all tt-overlap-series episodes
    const slot1Deletions = deleteCalls.filter(
      (c) =>
        (c.body && c.body.p_profile_id === 1) ||
        (c.url.includes("profile_id=eq.1") && c.url.includes("content_id=eq.tt-overlap-series")),
    );
    for (const call of slot1Deletions) {
      if (call.body?.p_keys) {
        assert.ok(
          call.body.p_keys.includes("tt-overlap-series:1:1"),
          "slot 1 deletion must specify exact key for S1E1",
        );
        assert.ok(
          !call.body.p_keys.includes("tt-overlap-series:1:2"),
          "slot 1 deletion must NOT delete S1E2",
        );
      } else if (call.url.includes("episode=eq.")) {
        assert.ok(
          call.url.includes("episode=eq.1"),
          "slot 1 deletion must target exact episode=eq.1",
        );
        assert.ok(!call.url.includes("episode=eq.2"), "slot 1 deletion must NOT target episode 2");
      }
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("multi-account isolation: transferring Account A leaves Account B caches completely untouched", async () => {
  clearNuvioSessionUnlocks();
  localStorage.clear();

  // Active session is Account A
  const mockState = {
    session: { access_token: "token-123", user: { id: "account-A" } },
    profiles: [
      { profile_index: 1, name: "Profile 1", pin_enabled: false },
      { profile_index: 2, name: "Profile 2", pin_enabled: false },
    ],
    activeProfileIndex: 1,
  };
  localStorage.setItem("harbor.account-provider", "nuvio");
  localStorage.setItem("harbor.nuvio.state.v1", JSON.stringify(mockState));

  // Account A data
  localStorage.setItem(
    "harbor.nuvio.playback_items.account-A.slot.1",
    JSON.stringify([{ _id: "item-A1" }]),
  );
  localStorage.setItem(
    "harbor.nuvio.playback_items.account-A.slot.2",
    JSON.stringify([{ _id: "item-A2" }]),
  );

  // Account B data (must never be touched or swapped!)
  const accountB1 = JSON.stringify([{ _id: "item-B1-untouched" }]);
  const accountB2 = JSON.stringify([{ _id: "item-B2-untouched" }]);
  localStorage.setItem("harbor.nuvio.playback_items.account-B.slot.1", accountB1);
  localStorage.setItem("harbor.nuvio.playback_items.account-B.slot.2", accountB2);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = nuvioSnapshotFetch();

  try {
    const ok = await transferPrimaryNuvioProfile(2);
    assert.equal(ok, true, "transfer for Account A must succeed");

    // Account A was swapped
    assert.equal(
      localStorage.getItem("harbor.nuvio.playback_items.account-A.slot.1"),
      JSON.stringify([{ _id: "item-A2" }]),
    );

    // Account B remains strictly UNCHANGED
    assert.equal(
      localStorage.getItem("harbor.nuvio.playback_items.account-B.slot.1"),
      accountB1,
      "Account B slot 1 data must not be touched by Account A transfer",
    );
    assert.equal(
      localStorage.getItem("harbor.nuvio.playback_items.account-B.slot.2"),
      accountB2,
      "Account B slot 2 data must not be touched by Account A transfer",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("remapPendingChangesProfileId remaps embedded row.profile_id for pending synchronization mutations", () => {
  const pending = {
    mutations: [
      {
        id: "m-1",
        table: "watch_progress",
        op: "upsert",
        row: {
          content_id: "tt123",
          profile_id: 1,
          season: 1,
          episode: 1,
        },
      },
      {
        id: "m-2",
        table: "watched_items",
        op: "insert",
        row: {
          content_id: "tt456",
          profile_id: 1,
        },
      },
    ],
  };

  const remappedJson = remapPendingChangesProfileId(JSON.stringify(pending), 2);
  const remapped = JSON.parse(remappedJson);

  assert.equal(remapped.mutations[0].row.profile_id, 2, "mutation 1 profile_id must be 2");
  assert.equal(remapped.mutations[1].row.profile_id, 2, "mutation 2 profile_id must be 2");
});

test("transfer aborts before mutating state when a cloud snapshot is incomplete", async () => {
  clearNuvioSessionUnlocks();
  localStorage.clear();

  const mockState = {
    session: { access_token: "token-123", user: { id: "acc-test" } },
    profiles: [
      { profile_index: 1, name: "Profile 1", pin_enabled: false },
      { profile_index: 2, name: "Profile 2", pin_enabled: false },
    ],
    activeProfileIndex: 1,
  };
  localStorage.setItem("harbor.account-provider", "nuvio");
  localStorage.setItem("harbor.nuvio.state.v1", JSON.stringify(mockState));

  const items1 = JSON.stringify([{ _id: "slot1-cw" }]);
  const items2 = JSON.stringify([{ _id: "slot2-cw" }]);
  localStorage.setItem("harbor.nuvio.playback_items.acc-test.slot.1", items1);
  localStorage.setItem("harbor.nuvio.playback_items.acc-test.slot.2", items2);

  let profilePushes = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url: any) => {
    const u = String(url);
    if (u.includes("sync_pull_watched_items")) return new Response("[]", { status: 200 });
    if (u.includes("/rest/v1/watched_items?")) {
      return new Response("[]", {
        status: 200,
        headers: new Headers({ "Content-Range": "*/0" }),
      });
    }
    if (u.includes("sync_pull_watch_progress") || u.includes("/rest/v1/watch_progress?")) {
      return new Response("snapshot unavailable", { status: 500 });
    }
    if (u.includes("sync_push_profiles")) profilePushes++;
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

  try {
    const ok = await transferPrimaryNuvioProfile(2);
    assert.equal(ok, false, "transfer must abort when a snapshot cannot be read completely");
    assert.equal(profilePushes, 0, "must not mutate cloud profiles before a complete snapshot");
    assert.equal(
      localStorage.getItem("harbor.nuvio.playback_items.acc-test.slot.1"),
      items1,
      "slot 1 cache must remain untouched after an aborted transfer",
    );
    assert.equal(
      localStorage.getItem("harbor.nuvio.playback_items.acc-test.slot.2"),
      items2,
      "slot 2 cache must remain untouched after an aborted transfer",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("transfer verifies a supplied target PIN without a prior session unlock", async () => {
  clearNuvioSessionUnlocks();
  localStorage.clear();

  const mockState = {
    session: { access_token: "token-123", user: { id: "acc-test" } },
    profiles: [
      { profile_index: 1, name: "Profile 1", pin_enabled: false },
      { profile_index: 2, name: "Profile 2", pin_enabled: true },
    ],
    activeProfileIndex: 1,
  };
  localStorage.setItem("harbor.account-provider", "nuvio");
  localStorage.setItem("harbor.nuvio.state.v1", JSON.stringify(mockState));

  const items1 = JSON.stringify([{ _id: "slot1-cw" }]);
  const items2 = JSON.stringify([{ _id: "slot2-cw" }]);
  localStorage.setItem("harbor.nuvio.playback_items.acc-test.slot.1", items1);
  localStorage.setItem("harbor.nuvio.playback_items.acc-test.slot.2", items2);

  let verifyCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = nuvioSnapshotFetch((u) => {
    if (u.includes("verify_profile_pin")) {
      verifyCalls++;
      return new Response(JSON.stringify({ unlocked: true }), { status: 200 });
    }
    if (u.includes("set_profile_pin") || u.includes("clear_profile_pin")) {
      return new Response(JSON.stringify({ unlocked: true }), { status: 200 });
    }
    return null;
  });

  try {
    const ok = await transferPrimaryNuvioProfile(2, { targetPin: "4321" });
    assert.equal(ok, true, "a supplied target PIN must unlock the transfer path");
    assert.equal(verifyCalls, 1, "the supplied target PIN must be verified with the server");
    assert.equal(
      localStorage.getItem("harbor.nuvio.playback_items.acc-test.slot.1"),
      items2,
      "slot 1 must receive slot 2 items after a PIN-verified transfer",
    );
    assert.equal(
      localStorage.getItem("harbor.nuvio.playback_items.acc-test.slot.2"),
      items1,
      "slot 2 must receive slot 1 items after a PIN-verified transfer",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("editor-view surfaces transfer failures without closing editor dialog", () => {
  assert.match(
    editorView,
    /const \[transferError,\s*setTransferError\] = useState<string \| null>\(null\);/,
    "editor-view must manage transferError state",
  );
  assert.match(
    editorView,
    /const ok = await transferPrimaryNuvioProfile\(targetSlot, \{/,
    "editor-view must capture boolean return from transferPrimaryNuvioProfile",
  );
  assert.match(
    editorView,
    /if \(!ok\) \{\s*setTransferError\([\s\S]*?\);\s*setTransferBusy\(false\);\s*return;\s*\}/,
    "editor-view must set transferError and return early without closing dialog on failure",
  );
  assert.match(
    editorView,
    /\{transferError && \(\s*<p className="[^"]*text-red-400"[^>]*>\{transferError\}<\/p>\s*\)\}/,
    "editor-view must render transferError in red",
  );
});
