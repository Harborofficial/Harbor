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

import { readActiveProfileIdentity, readAllProfilesIdentity } from "@/lib/profiles";
import { saveNuvioState, loadNuvioState } from "@/lib/nuvio/nuvio-client";
import { updateNuvioProfile } from "@/lib/nuvio/nuvio-profiles";

test("Nuvio profile avatar isolation and updating", async (t) => {
  localStorage.clear();
  localStorage.setItem(
    "harbor.profiles.v1",
    JSON.stringify({
      activeId: "stremio-profile-1",
      profiles: [
        {
          id: "stremio-profile-1",
          name: "Stremio Primary User",
          avatar: "https://example.com/stremio-pfp.png",
          color: "#ff0000",
          isPrimary: true,
        },
      ],
    })
  );
  localStorage.setItem("harbor.settings", JSON.stringify({ harborAvatar: "https://example.com/stremio-pfp.png" }));

  // Switch to Nuvio mode
  localStorage.setItem("harbor.account-provider", "nuvio");
  saveNuvioState({
    activeProfileIndex: 1,
    profiles: [
      {
        id: "nuvio-p1",
        user_id: "user-1",
        profile_index: 1,
        name: "Nuvio User",
        avatar_color_hex: "#1E88E5",
        avatar_url: null,
        avatar_id: null,
      },
    ],
  });

  await t.test("readActiveProfileIdentity returns Nuvio profile and never leaks Stremio avatar", () => {
    const active = readActiveProfileIdentity();
    assert.ok(active);
    assert.equal(active.name, "Nuvio User");
    assert.equal(active.avatar, null, "Should not leak Stremio avatar");
    assert.notEqual(active.avatar, "https://example.com/stremio-pfp.png");
  });

  await t.test("readAllProfilesIdentity returns Nuvio profiles only", () => {
    const list = readAllProfilesIdentity();
    assert.equal(list.length, 1);
    assert.equal(list[0].name, "Nuvio User");
    assert.notEqual(list[0].avatar, "https://example.com/stremio-pfp.png");
  });

  await t.test("updating profile avatar in Nuvio mode sets avatar_url in Nuvio state", async () => {
    const customAvatar = "https://example.com/nuvio-new-avatar.png";
    await updateNuvioProfile(1, { avatar_url: customAvatar });

    const updatedState = loadNuvioState();
    const p1 = updatedState.profiles.find((p) => p.profile_index === 1);
    assert.equal(p1?.avatar_url, customAvatar);

    const activeIdentity = readActiveProfileIdentity();
    assert.equal(activeIdentity?.avatar, customAvatar);
  });
});
