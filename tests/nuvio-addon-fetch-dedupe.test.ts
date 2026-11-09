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

const addonUrls = [
  "https://addon-one.example/manifest.json",
  "https://addon-two.example/manifest.json",
];
const manifestRequests: string[] = [];

(globalThis as any).fetch = async (input: any) => {
  const url = String(typeof input === "string" ? input : (input?.url ?? input));
  if (url.includes("/rest/v1/addons")) {
    return {
      ok: true,
      status: 200,
      json: async () =>
        addonUrls.map((url, i) => ({
          url,
          name: `Addon ${i + 1}`,
          enabled: true,
          sort_order: i,
        })),
      text: async () => "[]",
    };
  }
  if (url.endsWith("/manifest.json")) {
    manifestRequests.push(url);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        id: `com.test.addon${manifestRequests.length}`,
        name: `Addon ${manifestRequests.length}`,
        version: "1.0.0",
        resources: ["stream"],
        types: ["movie"],
        catalogs: [],
      }),
      text: async () => "",
    };
  }
  return { ok: true, status: 200, json: async () => [], text: async () => "[]" };
};

import { saveNuvioState } from "@/lib/nuvio/nuvio-client";
import { fetchNuvioAddons } from "@/lib/nuvio/nuvio-sync";
import { fetchInstalledAddons } from "@/lib/addon-store";

test("concurrent Nuvio addon fetches share one manifest burst", async () => {
  localStorage.clear();
  localStorage.setItem("harbor.account-provider", "nuvio");
  saveNuvioState({
    activeProfileIndex: 1,
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
    ],
    lastSyncedAt: Date.now(),
  });
  manifestRequests.length = 0;

  const results = await Promise.all([
    fetchNuvioAddons(),
    fetchNuvioAddons(),
    fetchInstalledAddons(),
  ]);

  assert.equal(manifestRequests.length, 2, "each addon manifest fetched exactly once");
  for (const list of results) assert.equal(list.length, 2);

  await fetchNuvioAddons();
  assert.equal(manifestRequests.length, 2, "a later wave reads the manifest cache");
});
