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
}

import { openMyProfile } from "../src/lib/social/open-my-profile.ts";
import { subscribeOpenProfile } from "../src/lib/social/open-profile.ts";
import { reloadSession } from "../src/lib/theme-auth.ts";
import { saveNuvioState } from "../src/lib/nuvio/nuvio-client.ts";

test("Profile navigation and handle update on account provider change", async () => {
  localStorage.clear();

  // 1. Setup Nuvio state with primary profile and Harbor session
  localStorage.setItem("harbor.account-provider", "nuvio");
  saveNuvioState({
    activeProfileIndex: 1,
    profiles: [
      { profile_index: 1, name: "Living Room Primary" },
      { profile_index: 2, name: "Guest Room" },
    ],
    session: {
      access_token: "tok_nuvio",
      refresh_token: "ref_nuvio",
      expires_at: Date.now() + 3600,
      token_type: "bearer",
      user: { id: "u_nuvio", email: "nuvio@harbor.local" },
    },
    lastSyncedAt: Date.now(),
  });
  localStorage.setItem(
    "harbor.theme-session.nuvio",
    JSON.stringify({
      token: "tok_nuvio_harbor",
      user: { id: "u_nuvio_harbor", username: "NuvioHarbor", handle: "nuvio_harbor_handle" },
    })
  );

  reloadSession(true);

  let opened: { handle: string; options?: any } | null = null;
  const unsub = subscribeOpenProfile((h, opts) => {
    opened = { handle: h, options: opts };
  });

  // In Nuvio mode, openMyProfile must open the Harbor authorized handle ("nuvio_harbor_handle")
  // and mark isMyProfile: true
  const okNuvio = await openMyProfile();
  assert.equal(okNuvio, true);
  assert.equal(opened?.handle, "nuvio_harbor_handle");
  assert.equal(opened?.options?.isMyProfile, true);

  // 2. Setup Stremio state with primary profile and separate Harbor session
  localStorage.setItem("harbor.account-provider", "stremio");
  localStorage.setItem(
    "harbor.profiles.v1",
    JSON.stringify({
      activeId: "p_stremio_1",
      profiles: [
        { id: "p_stremio_1", isPrimary: true, name: "Stremio Captain" },
        { id: "p_stremio_2", isPrimary: false, name: "Stremio Secondary" },
      ],
    })
  );
  localStorage.setItem(
    "harbor.theme-session.p_stremio_1",
    JSON.stringify({
      token: "tok_stremio_harbor",
      user: { id: "u_stremio_harbor", username: "StremioHarbor", handle: "stremio_harbor_handle" },
    })
  );

  reloadSession(true);

  // In Stremio mode, openMyProfile must open Stremio's Harbor authorized handle ("stremio_harbor_handle")
  const okStremio = await openMyProfile();
  assert.equal(okStremio, true);
  assert.equal(opened?.handle, "stremio_harbor_handle");
  assert.equal(opened?.options?.isMyProfile, true);

  unsub();
});
