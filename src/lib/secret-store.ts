import { invoke } from "@tauri-apps/api/core";
import { profilesForSessionAdoption } from "./active-profile-id";

const SECRET_PREFIXES = [
  "harbor.lastfm.v1",
  "harbor.sports.api-sports.v1",
  "harbor.simkl.session.v1",
  "harbor.trakt.session.v1",
  "harbor.mal.session.v1",
  "harbor.anilist.session.v1",
  "harbor.media-server.token.v1",
  "harbor.plex-auth.device.v1",
  "harbor.publicmetadb.session.v1",
];

let store: Record<string, string> = {};
let rustAvailable = false;
let loaded = false;
let persistTimer: number | null = null;
let persistChain: Promise<void> = Promise.resolve();

/**
 * Session and credential keys change rarely and losing one costs the listener a
 * re-login — a rotated refresh token, for instance, is invalid server-side as soon as
 * it is handed out. They skip the debounce a sudden quit can cut short; everything
 * else still batches.
 */
const IMMEDIATE_KEY_PREFIXES = [
  "harbor.lastfm.v1",
  "harbor.sports.api-sports.v1",
  "harbor.simkl.session.v1",
  "harbor.trakt.session.v1",
  "harbor.mal.session.v1",
  "harbor.anilist.session.v1",
  "harbor.media-server.token.v1",
  "harbor.plex-auth.device.v1",
  "harbor.publicmetadb.session.v1",
];

function isImmediateKey(key: string): boolean {
  return IMMEDIATE_KEY_PREFIXES.some((prefix) => key === prefix || key.startsWith(`${prefix}.`));
}

export function isSecretKey(key: string): boolean {
  return SECRET_PREFIXES.some((p) => key === p || key.startsWith(`${p}.`));
}

/** Rewrites a session key so it targets a specific profile, used when restoring a backup. */
export function secretKeyForProfile(key: string, profileId: string): string {
  for (const prefix of SECRET_PREFIXES) {
    if (key === prefix || key.startsWith(`${prefix}.`)) return `${prefix}.${profileId}`;
  }
  return key;
}

/** Snapshot of the Rust-persisted secret store, for backup/export use. */
export function getAllSecrets(): Record<string, string> {
  return { ...store };
}

async function persist(): Promise<void> {
  if (!rustAvailable) return;
  try {
    await invoke("secrets_write", { content: JSON.stringify(store) });
  } catch {
    void 0;
  }
}

/** Writes in order, so an old snapshot can never land after a newer one. */
function persistSoon(): Promise<void> {
  persistChain = persistChain.then(persist, persist);
  return persistChain;
}

function schedulePersist(): void {
  if (persistTimer != null) return;
  persistTimer = window.setTimeout(() => {
    persistTimer = null;
    void persistSoon();
  }, 200);
}

/** Flushes any pending secret writes immediately, for callers about to leave the page. */
export async function flushSecrets(): Promise<void> {
  if (persistTimer != null) {
    window.clearTimeout(persistTimer);
    persistTimer = null;
  }
  await persistSoon();
}

export async function loadSecrets(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    const raw = await invoke<string | null>("secrets_read");
    rustAvailable = true;
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object") store = parsed as Record<string, string>;
    }
  } catch {
    rustAvailable = false;
    return;
  }

  let migrated = false;
  try {
    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const key = localStorage.key(i);
      if (!key || !isSecretKey(key)) continue;
      const val = localStorage.getItem(key);
      if (val != null && store[key] == null) {
        store[key] = val;
        migrated = true;
      }
    }
  } catch {
    void 0;
  }

  if (migrated) {
    await persistSoon();
    try {
      for (const key of Object.keys(store)) {
        if (isSecretKey(key)) localStorage.removeItem(key);
      }
    } catch {
      void 0;
    }
  }

  // Readers that mounted before this resolved saw an empty store, and migration has
  // already removed the localStorage copies they would have fallen back to, so every
  // connected account read as signed out until something re-read it. Tell them now.
  try {
    window.dispatchEvent(new Event(SECRETS_READY));
  } catch {
    void 0;
  }
}

/** Fires once the persisted store is in memory, so session readers can re-read. */
export const SECRETS_READY = "harbor:secrets-ready";

export function subscribeSecretsReady(fn: () => void): () => void {
  if (loaded && rustAvailable) fn();
  if (typeof window !== "undefined") {
    window.addEventListener(SECRETS_READY, fn);
    return () => window.removeEventListener(SECRETS_READY, fn);
  }
  return () => {};
}

export function getSecret(key: string): string | null {
  if (rustAvailable) {
    if (store[key] != null) return store[key];
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Tracker sessions follow the account, not the profile: a connection made once serves
 * every profile on this device, so it lives under one shared key. Older builds stored a
 * session per profile — the first copy found (the active profile, then the main one) is
 * adopted, and a disconnect clears the rest so nothing resurrects it.
 */
export function readSharedSecret(base: string): string | null {
  const shared = getSecret(base);
  if (shared) return shared;
  for (const id of profilesForSessionAdoption()) {
    const found = getSecret(`${base}.${id}`);
    if (!found) continue;
    setSecret(`${base}.${id}`, null);
    setSecret(base, found);
    return found;
  }
  return null;
}

/** Writes the shared session; a disconnect also removes every per-profile copy. */
export function writeSharedSecret(base: string, value: string | null): void {
  setSecret(base, value);
  if (value !== null) return;
  for (const id of profilesForSessionAdoption()) setSecret(`${base}.${id}`, null);
}

export function setSecret(key: string, value: string | null): void {
  if (rustAvailable) {
    if (value == null) delete store[key];
    else store[key] = value;
    if (isImmediateKey(key)) void persistSoon();
    else schedulePersist();
    try {
      localStorage.removeItem(key);
    } catch {
      void 0;
    }
    return;
  }
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    void 0;
  }
}
