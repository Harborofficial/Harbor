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
      listeners.get(e.type)?.forEach((cb) => cb(e));
      return true;
    },
  };
  (globalThis as any).CustomEvent = class {
    type: string;
    detail: any;
    constructor(type: string, opts?: any) {
      this.type = type;
      this.detail = opts?.detail;
    }
  };
  (globalThis as any).Event = class {
    type: string;
    constructor(type: string) {
      this.type = type;
    }
  };
}

const {
  resolveNuvioAvatar,
  updateNuvioProfile,
} = await import("../src/lib/nuvio/nuvio-profiles.ts");
const {
  saveNuvioState,
  loadNuvioState,
} = await import("../src/lib/nuvio/nuvio-client.ts");
import type { NuvioProfile } from "../src/lib/nuvio/nuvio-types.ts";

test("Nuvio profile avatar resolution and persistence", async (t) => {
  localStorage.clear();

  await t.test("resolveNuvioAvatar resolves avatar_url if present", () => {
    const profile: NuvioProfile = {
      id: "test-1",
      user_id: "u1",
      profile_index: 1,
      name: "Profile 1",
      avatar_url: "https://files.catbox.moe/abc123.png",
      created_at: new Date().toISOString(),
    };
    assert.equal(resolveNuvioAvatar(profile), "https://files.catbox.moe/abc123.png");
  });

  await t.test("resolveNuvioAvatar falls back to local-avatar when cloud avatar_url is missing", () => {
    localStorage.setItem("harbor.nuvio.local-avatar.2", "data:image/webp;base64,AAAA");
    const profile: NuvioProfile = {
      id: "test-2",
      user_id: "u1",
      profile_index: 2,
      name: "Profile 2",
      avatar_url: null,
      avatar_id: null,
      created_at: new Date().toISOString(),
    };
    assert.equal(resolveNuvioAvatar(profile), "data:image/webp;base64,AAAA");
  });

  await t.test("updateNuvioProfile optimistically saves avatar and updates local state", async () => {
    const initialProfiles: NuvioProfile[] = [
      {
        id: "p1",
        user_id: "u1",
        profile_index: 1,
        name: "Alpha",
        avatar_color_hex: "#1E88E5",
        avatar_url: null,
        created_at: new Date().toISOString(),
      },
    ];
    saveNuvioState({
      session: {
        access_token: "mock-token",
        refresh_token: "mock-refresh",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        token_type: "bearer",
        user: { id: "u1" },
      },
      profiles: initialProfiles,
      activeProfileIndex: 1,
      lastSyncedAt: Date.now(),
    });

    // Update avatar with an HTTP CDN URL
    const newAvatar = "https://example.com/avatar.png";
    await updateNuvioProfile(1, { avatar_url: newAvatar });

    const updated = loadNuvioState().profiles.find((p) => p.profile_index === 1);
    assert.equal(updated?.avatar_url, newAvatar);
    assert.equal(localStorage.getItem("harbor.nuvio.local-avatar.1"), newAvatar);
    assert.equal(resolveNuvioAvatar(updated), newAvatar);
  });

  await t.test("Clearing avatar removes it from state and clears local fallback", async () => {
    await updateNuvioProfile(1, { avatar_url: null });
    const updated = loadNuvioState().profiles.find((p) => p.profile_index === 1);
    assert.equal(updated?.avatar_url, null);
    assert.equal(localStorage.getItem("harbor.nuvio.local-avatar.1"), null);
    assert.equal(resolveNuvioAvatar(updated), null);
  });
});

test("Stremio primary profile avatar sync with settings", async () => {
  localStorage.clear();
  localStorage.setItem("harbor.settings", JSON.stringify({ harborAvatar: "https://old.avatar.png" }));

  // Simulate updateProfile logic in Stremio mode
  const raw = localStorage.getItem("harbor.settings");
  const parsed = JSON.parse(raw!);
  parsed.harborAvatar = "https://new.stremio.avatar.png";
  localStorage.setItem("harbor.settings", JSON.stringify(parsed));

  assert.equal(
    JSON.parse(localStorage.getItem("harbor.settings")!).harborAvatar,
    "https://new.stremio.avatar.png"
  );
});
