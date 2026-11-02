import "./_localstorage-stub.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  transferPrimaryNuvioProfile,
  markNuvioProfileUnlocked,
  clearNuvioSessionUnlocks,
} from "../src/lib/nuvio/nuvio-profiles";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const nuvioProfiles = read("../src/lib/nuvio/nuvio-profiles.ts");
const nuvioSync = read("../src/lib/nuvio/nuvio-sync.ts");
const nuvioPlayback = read("../src/lib/nuvio/nuvio-playback.ts");

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
  // Phase 1 verification
  assert.match(
    nuvioSync,
    /const ok =\s*await pushWatchedItemToNuvio\(\s*slotB/,
    "must push watched items to slotB and verify result",
  );
  assert.match(
    nuvioSync,
    /const ok =\s*await pushWatchedItemToNuvio\(\s*slotA/,
    "must push watched items to slotA and verify result",
  );
  assert.match(
    nuvioSync,
    /const ok =\s*await pushWatchProgressToNuvio\(\s*slotB/,
    "must push watch progress to slotB and verify result",
  );
  assert.match(
    nuvioSync,
    /const ok =\s*await pushWatchProgressToNuvio\(\s*slotA/,
    "must push watch progress to slotA and verify result",
  );

  // Recovery rollback on write failure
  assert.match(
    nuvioSync,
    /rollbackDestinationWrites/,
    "must implement rollback for destination writes on partial failure",
  );

  // Phase 2: deletes source data ONLY after writes succeed
  assert.match(
    nuvioSync,
    /deleteWatchedItemFromNuvio\(\s*slotA/,
    "must delete source watched items from slotA after confirmation",
  );
  assert.match(
    nuvioSync,
    /deleteWatchProgressFromNuvio\(slotA/,
    "must delete source watch progress from slotA after confirmation",
  );
});

test("transferPrimaryNuvioProfile handles unavailable PIN credentials explicitly", () => {
  assert.match(
    nuvioProfiles,
    /if \(slot1\.pin_enabled && \(!pinPlain1 \|\| !pinPlain1\.trim\(\)\)\)/,
    "must explicitly reject transfer if slot 1 PIN is enabled but credentials unavailable",
  );
  assert.match(
    nuvioProfiles,
    /if \(targetSlot\.pin_enabled && \(!pinPlainTarget \|\| !pinPlainTarget\.trim\(\)\)\)/,
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
  localStorage.setItem("harbor.nuvio.state.v1", JSON.stringify(mockState));
  markNuvioProfileUnlocked(1);
  markNuvioProfileUnlocked(2);

  const initialItems1 = JSON.stringify([{ _id: "item-1" }]);
  const initialItems2 = JSON.stringify([{ _id: "item-2" }]);
  localStorage.setItem("harbor.nuvio.playback_items.acc-test.slot.1", initialItems1);
  localStorage.setItem("harbor.nuvio.playback_items.acc-test.slot.2", initialItems2);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url: any) => {
    const u = String(_url);
    if (u.includes("sync_push_profiles")) {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    if (u.includes("set_profile_pin")) {
      // Backend rejects PIN
      return new Response(JSON.stringify({ unlocked: false, message: "PIN rejected by server" }), {
        status: 200,
      });
    }
    return new Response(JSON.stringify({}), { status: 200 });
  };

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
  globalThis.fetch = async (_url: any) => {
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

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
