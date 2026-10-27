import test from "node:test";
import assert from "node:assert/strict";

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
  (globalThis as any).Event = class Event {
    type: string;
    constructor(type: string) {
      this.type = type;
    }
  };
}

(globalThis as any).fetch = async (url: string, opts?: any) => {
  if (url.includes("/manifest.json")) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        id: "com.test.nuvioaddon",
        name: "Test Nuvio Addon",
        version: "1.0.0",
        resources: ["stream"],
        types: ["movie", "series"],
        catalogs: [],
      }),
      text: async () => JSON.stringify({ id: "com.test.nuvioaddon", name: "Test Nuvio Addon" }),
    };
  }
  return {
    ok: true,
    status: 200,
    json: async () => ([]),
    text: async () => "ok",
  };
};

import { saveNuvioState } from "@/lib/nuvio/nuvio-client";
import {
  resolveEffectiveNuvioAddonSlot,
  readCachedNuvioAddons,
  writeCachedNuvioAddons,
  addAddonToNuvio,
  deleteAddonFromNuvio,
} from "@/lib/nuvio/nuvio-sync";
import { installAddon, uninstallAddon, loadInstalled } from "@/lib/addon-store";

test("Nuvio multi-profile addon isolation and syncing", async (t) => {
  localStorage.clear();
  localStorage.setItem("harbor.account-provider", "nuvio");

  saveNuvioState({
    activeProfileIndex: 2,
    session: {
      access_token: "mock-valid-token",
      token_type: "bearer",
      expires_in: 3600,
      refresh_token: "mock-refresh",
      user: { id: "user-1", email: "test@example.com" } as any,
    },
    profiles: [
      {
        id: "p1",
        user_id: "user-1",
        profile_index: 1,
        name: "Primary Profile",
        avatar_color_hex: "#1E88E5",
        uses_primary_addons: false,
      },
      {
        id: "p2",
        user_id: "user-1",
        profile_index: 2,
        name: "Secondary Separate Profile",
        avatar_color_hex: "#E53935",
        uses_primary_addons: false, // Explicitly separate!
      },
      {
        id: "p3",
        user_id: "user-1",
        profile_index: 3,
        name: "Secondary Inherited Profile",
        avatar_color_hex: "#43A047",
        uses_primary_addons: true, // Inherits slot 1!
      },
    ],
    lastSyncedAt: Date.now(),
  });

  await t.test("resolveEffectiveNuvioAddonSlot correctly isolates separate vs inherited profiles", () => {
    assert.equal(resolveEffectiveNuvioAddonSlot(1), 1, "Slot 1 always resolves to 1");
    assert.equal(resolveEffectiveNuvioAddonSlot(2), 2, "Profile 2 with uses_primary_addons: false resolves to 2");
    assert.equal(resolveEffectiveNuvioAddonSlot(3), 1, "Profile 3 with uses_primary_addons: true resolves to 1");
  });

  await t.test("Adding addon to profile 2 does not pollute profile 1", async () => {
    writeCachedNuvioAddons(1, [
      { url: "https://addon.primary.com/manifest.json", name: "Primary Addon", enabled: true, sort_order: 0 },
    ]);
    writeCachedNuvioAddons(2, [
      { url: "https://addon.secondary.com/manifest.json", name: "Secondary Addon", enabled: true, sort_order: 0 },
    ]);

    // Check slot 1 cached addons
    const p1Addons = readCachedNuvioAddons(1);
    assert.equal(p1Addons.length, 1);
    assert.equal(p1Addons[0].name, "Primary Addon");

    // Check slot 2 cached addons
    const p2Addons = readCachedNuvioAddons(2);
    assert.equal(p2Addons.length, 1);
    assert.equal(p2Addons[0].name, "Secondary Addon");

    // Add another addon to slot 2
    await addAddonToNuvio(2, {
      url: "https://addon2.secondary.com/manifest.json",
      name: "Second Addon for Profile 2",
    });

    const p2Updated = readCachedNuvioAddons(2);
    assert.equal(p2Updated.length, 2);

    // Profile 1 must remain untouched with only 1 addon
    const p1Untouched = readCachedNuvioAddons(1);
    assert.equal(p1Untouched.length, 1);
    assert.equal(p1Untouched[0].url, "https://addon.primary.com/manifest.json");
  });

  await t.test("Deleting addon from profile 2 removes it from profile 2 only", async () => {
    await deleteAddonFromNuvio(2, "https://addon.secondary.com/manifest.json");
    const p2AfterDelete = readCachedNuvioAddons(2);
    assert.equal(p2AfterDelete.length, 1);
    assert.equal(p2AfterDelete[0].name, "Second Addon for Profile 2");

    // Profile 1 still has its primary addon
    const p1StillSafe = readCachedNuvioAddons(1);
    assert.equal(p1StillSafe.length, 1);
  });

  await t.test("installAddon in Nuvio mode saves to nuvio profile slot and syncs to nuvio cloud", async () => {
    const installed = await installAddon("com.test.nuvioaddon", "https://addon3.nuvio.tv/manifest.json");
    assert.ok(installed);
    assert.equal(installed.manifest.name, "Test Nuvio Addon");

    // Check that loadInstalled returned the addon for nuvio-2
    const installedList = loadInstalled();
    assert.ok(installedList.some((a) => a.transportUrl === "https://addon3.nuvio.tv/manifest.json"));

    // Check that Nuvio cache for slot 2 contains this addon
    const slot2Cache = readCachedNuvioAddons(2);
    assert.ok(slot2Cache.some((a) => a.url === "https://addon3.nuvio.tv/manifest.json"));

    // Stremio storage must not have this installed addon
    assert.equal(localStorage.getItem("harbor.installed-addons.default"), null);

    // Now uninstall it
    await uninstallAddon("com.test.nuvioaddon", "https://addon3.nuvio.tv/manifest.json");
    const installedAfter = loadInstalled();
    assert.ok(!installedAfter.some((a) => a.transportUrl === "https://addon3.nuvio.tv/manifest.json"));
  });
});
