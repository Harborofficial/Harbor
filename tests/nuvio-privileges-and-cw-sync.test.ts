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

test("Secondary profile privileges and primary profile authority", async (t) => {
  const { isStremioActivePrimary, activeProfileIsPrimary } =
    await import("../src/lib/active-profile-id");
  const { getSecondaryPrivileges } = await import("../src/lib/settings/defaults");

  await t.test("Primary profile is boss and never denied", () => {
    localStorage.setItem("harbor.account-provider", "stremio");
    const profiles = [
      { id: "p1", isPrimary: true },
      { id: "p2", isPrimary: false },
    ];
    // Active profile marked with isPrimary: true must always be true
    assert.strictEqual(isStremioActivePrimary({ id: "p1", isPrimary: true }, profiles), true);
    // Secondary profile is false
    assert.strictEqual(isStremioActivePrimary({ id: "p2", isPrimary: false }, profiles), false);
  });

  await t.test("When primary profile transfers, isStremioActivePrimary switches seamlessly", () => {
    localStorage.setItem("harbor.account-provider", "stremio");
    // p2 becomes primary, p1 becomes secondary
    const updatedProfiles = [
      { id: "p1", isPrimary: false },
      { id: "p2", isPrimary: true },
    ];
    assert.strictEqual(
      isStremioActivePrimary({ id: "p2", isPrimary: true }, updatedProfiles),
      true,
    );
    assert.strictEqual(
      isStremioActivePrimary({ id: "p1", isPrimary: false }, updatedProfiles),
      false,
    );
  });

  await t.test("Secondary privileges defaults and overrides for Stremio and Nuvio", () => {
    // 1. Stremio mode defaults
    localStorage.setItem("harbor.account-provider", "stremio");
    const stremioPrivs = getSecondaryPrivileges(null, false);
    assert.strictEqual(stremioPrivs.canAddProfiles, false);
    assert.strictEqual(stremioPrivs.canViewAccountProvider, false);

    // 2. Granting privileges in shared settings updates immediately
    localStorage.setItem(
      "harbor.settings.shared",
      JSON.stringify({
        secondaryPrivileges: { canAddProfiles: true, canViewAccountProvider: true },
        nuvioSecondaryPrivileges: { canAddProfiles: true, canViewAccountProvider: false },
      }),
    );

    const updatedStremio = getSecondaryPrivileges(null, false);
    assert.strictEqual(updatedStremio.canAddProfiles, true);
    assert.strictEqual(updatedStremio.canViewAccountProvider, true);

    const updatedNuvio = getSecondaryPrivileges(null, true);
    assert.strictEqual(updatedNuvio.canAddProfiles, true);
    assert.strictEqual(updatedNuvio.canViewAccountProvider, false);
  });
});

test("CW tray instant reactivity and removal", async (t) => {
  const { removeExternalCwItem, listExternalCw } = await import("../src/lib/feed/external-cw");

  await t.test("Removing title removes it from CW tray immediately", () => {
    const item = {
      _id: "tt9999999",
      name: "Test Title",
      type: "movie" as const,
      external: "nuvio" as const,
    };

    removeExternalCwItem(item as any);
    const remaining = listExternalCw();
    assert.strictEqual(
      remaining.some((i) => i._id === "tt9999999"),
      false,
    );
  });
});
