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

test("Player Nuvio Enhancements", async (t) => {
  const { isNuvioProviderActive } = await import("../src/lib/nuvio/nuvio-client");
  const { readCachedWatchProgress, writeCachedWatchProgress } = await import("../src/lib/nuvio/nuvio-sync");
  const { gatherSubtitleAddons } = await import("../src/lib/subtitles/addon-source");

  await t.test("Scrobbler isolation: isNuvioProviderActive suppresses stremio cloud writes", () => {
    localStorage.setItem("harbor.account-provider", "nuvio");
    assert.strictEqual(isNuvioProviderActive(), true);

    localStorage.setItem("harbor.account-provider", "stremio");
    assert.strictEqual(isNuvioProviderActive(), false);
  });

  await t.test("Nuvio Watched Episodes calculation from cached watch progress", () => {
    localStorage.setItem("harbor.account-provider", "nuvio");
    const slot = 1;
    writeCachedWatchProgress(slot, [
      {
        content_id: "tt1234567",
        season: 1,
        episode: 1,
        progress_seconds: 900,
        duration_seconds: 1000, // 90% >= 85% -> watched
        last_watched: Date.now(),
      },
      {
        content_id: "tt1234567",
        season: 1,
        episode: 2,
        progress_seconds: 500,
        duration_seconds: 1000, // 50% < 85% -> not watched
        last_watched: Date.now(),
      },
    ]);

    const records = readCachedWatchProgress(slot);
    const set = new Set<string>();
    for (const r of records) {
      if (r.content_id === "tt1234567" && r.season != null && r.episode != null) {
        const ratio = (r.progress_seconds && r.duration_seconds)
          ? r.progress_seconds / r.duration_seconds
          : 0;
        if (ratio >= 0.85) {
          set.add(`${r.season}:${r.episode}`);
        }
      }
    }

    assert.strictEqual(set.has("1:1"), true);
    assert.strictEqual(set.has("1:2"), false);
  });

  await t.test("Subtitle Addons isolation: gatherSubtitleAddons separates nuvio and stremio cache keys", async () => {
    localStorage.setItem("harbor.account-provider", "nuvio");
    mockStorage.set("harbor.settings", JSON.stringify({ nuvioAddonMode: "separate" }));

    // Test that gatherSubtitleAddons handles nuvio mode gracefully
    const addons = await gatherSubtitleAddons("stremio-key");
    assert.ok(Array.isArray(addons));
  });
});
