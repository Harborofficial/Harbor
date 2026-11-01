import test from "node:test";
import assert from "node:assert/strict";

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

if (typeof window === "undefined") {
  const listeners = new Map<string, Set<(e: any) => void>>();
  (globalThis as any).window = {
    addEventListener: (type: string, cb: any) => {
      let set = listeners.get(type);
      if (!set) {
        set = new Set();
        listeners.set(type, set);
      }
      set.add(cb);
    },
    removeEventListener: (type: string, cb: any) => {
      listeners.get(type)?.delete(cb);
    },
    dispatchEvent: (e: any) => {
      const set = listeners.get(e.type);
      if (set) {
        for (const cb of set) cb(e);
      }
      return true;
    },
  };
  (globalThis as any).CustomEvent = class CustomEvent {
    type: string;
    detail: any;
    constructor(type: string, opts?: any) {
      this.type = type;
      this.detail = opts?.detail;
    }
  };
}

import { dismissEpisodes, isDismissed } from "../src/lib/new-episodes.ts";
import { openMyProfile } from "../src/lib/social/open-my-profile.ts";
import { signOutNuvio } from "../src/lib/nuvio/nuvio-auth.ts";
import { saveNuvioState } from "../src/lib/nuvio/nuvio-client.ts";

test("New episodes row dismissal isolates by profile scopeKey", () => {
  localStorage.clear();

  const slot1 = "nuvio.1";
  const slot2 = "nuvio.2";
  const stremio = "stremio.default";

  // Dismiss ep 5 for show tt0903747 in slot 1
  dismissEpisodes(["tt0903747:1:5"], slot1);

  // Must be dismissed in slot 1
  assert.equal(isDismissed("tt0903747:1:5", slot1), true);

  // Must NOT be dismissed in slot 2 or Stremio
  assert.equal(isDismissed("tt0903747:1:5", slot2), false);
  assert.equal(isDismissed("tt0903747:1:5", stremio), false);

  // Dismiss ep 3 for show tt0903747 in Stremio
  dismissEpisodes(["tt0903747:1:3"], stremio);
  assert.equal(isDismissed("tt0903747:1:3", stremio), true);
  assert.equal(isDismissed("tt0903747:1:3", slot1), false);
  assert.equal(isDismissed("tt0903747:1:3", slot2), false);
});

test("openMyProfile in Nuvio mode resolves primary profile handle directly", async () => {
  localStorage.clear();
  localStorage.setItem("harbor.account-provider", "nuvio");
  saveNuvioState({
    session: {
      access_token: "mock-nuvio-token",
      refresh_token: "mock-ref",
      expires_at: Date.now() + 3600,
      token_type: "bearer",
      user: { id: "user-123", email: "walter@nuvio.tv" },
    },
    profiles: [
      { profile_index: 1, name: "Heisenberg", avatar_color_hex: "#1E88E5" },
      { profile_index: 2, name: "Jesse", avatar_color_hex: "#E53935" },
    ],
    activeProfileIndex: 2, // Secondary is active
    lastSyncedAt: Date.now(),
  });

  let openedHandle = "";
  const { subscribeOpenProfile } = await import("../src/lib/social/open-profile.ts");
  const unsub = subscribeOpenProfile((h) => {
    openedHandle = h;
  });

  const ok = await openMyProfile();
  unsub();

  assert.equal(ok, true);
  // Must strictly open the PRIMARY profile handle ("heisenberg"), not the secondary profile
  assert.equal(openedHandle, "heisenberg");
});

test("signOutNuvio purges all nuvio cache, resets provider to stremio, and dispatches change events", async () => {
  localStorage.clear();
  localStorage.setItem("harbor.account-provider", "nuvio");
  localStorage.setItem("harbor.settings", JSON.stringify({ accountProvider: "nuvio" }));
  localStorage.setItem("harbor.settings.shared", JSON.stringify({ accountProvider: "nuvio" }));
  localStorage.setItem("harbor.nuvio.local-cw.1", JSON.stringify([{ id: "tt123" }]));
  localStorage.setItem("harbor.newEpisodes.dismissed.nuvio.1", JSON.stringify(["tt123:1:1"]));

  saveNuvioState({
    session: {
      access_token: "tok",
      refresh_token: "ref",
      expires_at: Date.now() + 3600,
      token_type: "bearer",
      user: { id: "u1" },
    },
    profiles: [],
    activeProfileIndex: 1,
    lastSyncedAt: Date.now(),
  });

  let providerChanged = "";
  const onProvider = (e: Event) => {
    providerChanged = (e as CustomEvent)?.detail?.provider;
  };
  window.addEventListener("harbor:account-provider-changed", onProvider);

  await signOutNuvio();
  window.removeEventListener("harbor:account-provider-changed", onProvider);

  // Must reset accountProvider to stremio
  assert.equal(localStorage.getItem("harbor.account-provider"), "stremio");
  assert.equal(
    JSON.parse(localStorage.getItem("harbor.settings") || "{}").accountProvider,
    "stremio",
  );
  assert.equal(providerChanged, "stremio");

  // Nuvio cache keys must be purged
  assert.equal(localStorage.getItem("harbor.nuvio.local-cw.1"), null);
  assert.equal(localStorage.getItem("harbor.newEpisodes.dismissed.nuvio.1"), null);
});

test("Trakt watchlist export and import work with Nuvio library in Nuvio mode", async () => {
  localStorage.clear();
  localStorage.setItem("harbor.account-provider", "nuvio");
  saveNuvioState({
    session: {
      access_token: "mock-token",
      refresh_token: "ref",
      expires_at: Date.now() + 3600,
      token_type: "bearer",
      user: { id: "u1" },
    },
    profiles: [{ profile_index: 1, name: "Heisenberg" }],
    activeProfileIndex: 1,
    lastSyncedAt: Date.now(),
  });

  const { addNuvioLibraryItem, readCachedNuvioLibrary } =
    await import("../src/lib/nuvio/nuvio-library.ts");
  const { planExport, traktItemToStremioId } = await import("../src/lib/trakt/watchlist-sync.ts");

  // Add items to Nuvio library
  addNuvioLibraryItem(1, {
    content_id: "tt0903747",
    content_type: "series",
    name: "Breaking Bad",
    added_at: Date.now(),
  });

  const nuvioLib = readCachedNuvioLibrary(1);
  assert.equal(nuvioLib.length, 1);

  // Plan export for Nuvio library items
  const sources = nuvioLib.map((i) => ({ id: i.content_id, type: i.content_type }));
  const plan = planExport(sources);
  assert.equal(plan.shows.length, 1);
  assert.equal(plan.shows[0].ids.imdb, "tt0903747");

  // Import Trakt item into Nuvio
  const traktShow = {
    title: "Better Call Saul",
    type: "show",
    ids: { imdb: "tt3032476", tmdb: 60059 },
  };
  const importedId = traktItemToStremioId(traktShow as any);
  assert.equal(importedId, "tt3032476");

  addNuvioLibraryItem(1, {
    content_id: importedId!,
    content_type: traktShow.type === "show" ? "series" : "movie",
    name: traktShow.title,
    added_at: Date.now(),
  });

  const updatedLib = readCachedNuvioLibrary(1);
  assert.equal(updatedLib.length, 2);
  assert.ok(updatedLib.some((i) => i.content_id === "tt3032476"));
});

test("View my profile is restricted to primary profile in Stremio and Nuvio", async () => {
  const { activeProfileIsPrimary, isStremioActivePrimary } =
    await import("../src/lib/active-profile-id.ts");

  // Nuvio mode: slot 1 is primary, slot 2 is secondary
  localStorage.setItem("harbor.account-provider", "nuvio");
  saveNuvioState({ activeProfileIndex: 1, profiles: [], lastSyncedAt: Date.now() });
  assert.equal(activeProfileIsPrimary(), true);

  saveNuvioState({ activeProfileIndex: 2, profiles: [], lastSyncedAt: Date.now() });
  assert.equal(activeProfileIsPrimary(), false);

  // Stremio mode: primary flag or first profile
  localStorage.setItem("harbor.account-provider", "stremio");
  const profiles = [
    { id: "p1", name: "Captain", isPrimary: true },
    { id: "p2", name: "Guest", isPrimary: false },
  ];
  assert.equal(isStremioActivePrimary(profiles[0], profiles), true);
  assert.equal(isStremioActivePrimary(profiles[1], profiles), false);
});

test("openMyProfile prioritizes Harbor-authorized handle over profile name in Nuvio mode", async () => {
  localStorage.clear();
  localStorage.setItem("harbor.account-provider", "nuvio");
  saveNuvioState({
    session: {
      access_token: "tok",
      refresh_token: "ref",
      expires_at: Date.now() + 3600,
      token_type: "bearer",
      user: { id: "u1", email: "nuvio@harbor.local" },
    },
    profiles: [
      { profile_index: 1, name: "Heisenberg" },
      { profile_index: 2, name: "Pinkman" },
    ],
    activeProfileIndex: 1,
    lastSyncedAt: Date.now(),
  });

  const { reloadSession } = await import("../src/lib/theme-auth.ts");

  // 1. With Harbor authorized session, handle must be author.handle ("walter_harbor"), NOT profile name ("heisenberg")
  localStorage.setItem(
    "harbor.theme-session.nuvio",
    JSON.stringify({
      token: "tok_harbor",
      user: { id: "auth1", username: "Walter", handle: "walter_harbor" },
    }),
  );
  reloadSession(true);

  const { openMyProfile } = await import("../src/lib/social/open-my-profile.ts");
  const { subscribeOpenProfile } = await import("../src/lib/social/open-profile.ts");

  let openedHandle = "";
  let isMyProfileOpt = false;
  let unsub = subscribeOpenProfile((h, opts) => {
    openedHandle = h;
    isMyProfileOpt = opts?.isMyProfile === true;
  });

  let ok = await openMyProfile();
  unsub();

  assert.equal(ok, true);
  assert.equal(openedHandle, "walter_harbor");
  assert.equal(isMyProfileOpt, true);

  // 2. Without Harbor session, handle falls back to primary profile name ("heisenberg")
  localStorage.removeItem("harbor.theme-session.nuvio");
  reloadSession(true);

  unsub = subscribeOpenProfile((h, opts) => {
    openedHandle = h;
    isMyProfileOpt = opts?.isMyProfile === true;
  });

  ok = await openMyProfile();
  unsub();

  assert.equal(ok, true);
  assert.equal(openedHandle, "heisenberg");
  assert.equal(isMyProfileOpt, true);
});

test("Dismissed Next-Up cache is strictly isolated by account ID", async () => {
  const { readCachedDismissedNextUpKeys, writeCachedDismissedNextUpKeys } =
    await import("../src/lib/nuvio/nuvio-sync.ts");

  // Write dismissed keys under Account A
  writeCachedDismissedNextUpKeys(1, new Set(["tt1111111|1|1"]), "account_A");

  // Write different dismissed keys under Account B
  writeCachedDismissedNextUpKeys(1, new Set(["tt2222222|1|1"]), "account_B");

  // Read back and verify strict isolation
  const keysA = readCachedDismissedNextUpKeys(1, "account_A");
  const keysB = readCachedDismissedNextUpKeys(1, "account_B");

  assert.equal(keysA.has("tt1111111|1|1"), true);
  assert.equal(keysA.has("tt2222222|1|1"), false, "Account A must not see Account B keys");

  assert.equal(keysB.has("tt2222222|1|1"), true);
  assert.equal(keysB.has("tt1111111|1|1"), false, "Account B must not see Account A keys");
});

test("transferPrimaryNuvioProfile rolls back and leaves data intact if backend rejects profile push", async () => {
  const { transferPrimaryNuvioProfile } = await import("../src/lib/nuvio/nuvio-profiles.ts");

  // Set up signed in Nuvio state with 2 profiles
  saveNuvioState({
    session: {
      access_token: "tok",
      refresh_token: "ref",
      expires_at: Date.now() + 3600,
      token_type: "bearer",
      user: { id: "u_test", email: "test@harbor.local" },
    },
    profiles: [
      { profile_index: 1, name: "Profile 1 Original" },
      { profile_index: 2, name: "Profile 2 Original" },
    ],
    activeProfileIndex: 1,
    lastSyncedAt: Date.now(),
  });

  // Store slot-specific data for slot 1 and slot 2
  localStorage.setItem("harbor.localcw.v1.nuvio-1", JSON.stringify([{ id: "item1" }]));
  localStorage.setItem("harbor.localcw.v1.nuvio-2", JSON.stringify([{ id: "item2" }]));

  // Mock global fetch to reject sync_push_profiles
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url: any, opts: any) => {
    if (String(url).includes("sync_push_profiles")) {
      return {
        ok: false,
        status: 500,
        json: async () => ({ message: "Internal server error" }),
        text: async () => "Internal server error",
      } as any;
    }
    return { ok: true, json: async () => [] } as any;
  };

  try {
    const success = await transferPrimaryNuvioProfile(2);
    // Push rejected -> operation must return false
    assert.equal(success, false, "Transfer must fail when backend rejects push");

    // Local data must NOT be swapped!
    const cw1 = localStorage.getItem("harbor.localcw.v1.nuvio-1");
    const cw2 = localStorage.getItem("harbor.localcw.v1.nuvio-2");
    assert.match(cw1 ?? "", /item1/, "Slot 1 data must remain intact and not swapped on failure");
    assert.match(cw2 ?? "", /item2/, "Slot 2 data must remain intact and not swapped on failure");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
