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
  assert.equal(JSON.parse(localStorage.getItem("harbor.settings") || "{}").accountProvider, "stremio");
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

  const { addNuvioLibraryItem, readCachedNuvioLibrary } = await import("../src/lib/nuvio/nuvio-library.ts");
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
