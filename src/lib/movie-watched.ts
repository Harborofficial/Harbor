import {
  isNuvioProviderActive,
  nuvioWatchedScope,
  canPersistWatched,
  stremioProfileId as activeProfileId,
  primaryProfileId,
  getNuvioActiveSlot,
} from "./active-profile-id";
import { useSyncExternalStore } from "react";
import { persistCritical } from "./storage-recovery";

const KEY_PREFIX = "harbor.moviewatched.v1.";
const LEGACY_KEY = "harbor.moviewatched.v1";

const subs = new Set<() => void>();
let version = 0;
let cache: Set<string> | null = null;


export function movieWatchedStoreKey(slotOrProfile?: string | number): string {
  if (isNuvioProviderActive()) {
    const slot = slotOrProfile != null ? Number(slotOrProfile) || getNuvioActiveSlot() : getNuvioActiveSlot();
    return `harbor.moviewatched.nuvio.v1.${slot}`;
  }
  const id = slotOrProfile ? String(slotOrProfile) : activeProfileId();
  return id ? KEY_PREFIX + id : LEGACY_KEY;
}

function storeKey(): string {
  return movieWatchedStoreKey();
}

function migrateLegacy(): void {
  if (isNuvioProviderActive()) return;
  try {
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (!legacy) return;
    const pid = primaryProfileId();
    if (!pid) return;
    const perKey = KEY_PREFIX + pid;
    if (!localStorage.getItem(perKey)) localStorage.setItem(perKey, legacy);
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    /* noop */
  }
}

let currentScope = "";

function load(): Set<string> {
  const sk = storeKey();
  if (cache && currentScope === sk) return cache;
  currentScope = sk;
  migrateLegacy();
  try {
    const arr = JSON.parse(localStorage.getItem(sk) ?? "[]");
    cache = new Set(
      Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : [],
    );
  } catch {
    cache = new Set();
  }
  return cache;
}

function persist(next: Set<string>, sk = storeKey()): void {
  if (!canPersistWatched()) return;
  if (sk === storeKey()) {
    currentScope = sk;
    cache = next;
    version += 1;
  }
  persistCritical(sk, JSON.stringify([...next]));
  for (const fn of subs) fn();
}

/** Apply one verified Nuvio snapshot without quadratic storage writes. */
export function reconcileNuvioMovieWatched(
  slot: number,
  serverIds: ReadonlySet<string>,
  accountId: string,
): void {
  if (!accountId) return;
  const key = `harbor.moviewatched.${nuvioWatchedScope(slot, accountId)}`;
  let previous: string[] = [];
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    if (Array.isArray(parsed))
      previous = parsed.filter((id): id is string => typeof id === "string");
  } catch {
    // Replace malformed cache with the verified cloud state.
  }
  const next = new Set(serverIds);
  if (previous.length === next.size && previous.every((id) => next.has(id))) return;
  persistCritical(key, JSON.stringify([...next]));
  if (storeKey() === key) {
    currentScope = key;
    cache = next;
  }
  version += 1;
  for (const fn of subs) fn();
}

export function isMovieWatchedLocal(metaId: string, altIds?: Array<string | null | undefined>): boolean {
  const set = load();
  if (set.has(metaId)) return true;
  if (altIds) {
    for (const alt of altIds) {
      if (alt && set.has(alt)) return true;
    }
  }
  return false;
}

export function movieWatchedIds(): Set<string> {
  return load();
}

const EMPTY_MOVIE_WATCHED_IDS: Set<string> = new Set();

export function useMovieWatchedIds(): Set<string> {
  return useSyncExternalStore(subscribeMovieWatched, load, () => EMPTY_MOVIE_WATCHED_IDS);
}

export function setMovieWatchedLocal(metaId: string, watched: boolean, profileOrSlot?: string | number): void {
  const sk = movieWatchedStoreKey(profileOrSlot);
  let s: Set<string>;
  if (sk === storeKey() && cache) {
    s = cache;
  } else {
    try {
      const arr = JSON.parse(localStorage.getItem(sk) ?? "[]");
      s = new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : []);
    } catch {
      s = new Set();
    }
  }
  if (s.has(metaId) === watched) return;
  const next = new Set(s);
  if (watched) next.add(metaId);
  else next.delete(metaId);
  persist(next, sk);
}

export function setMovieWatchedLocalAcknowledged(metaId: string, watched: boolean, profileOrSlot?: string | number): void {
  if (!canPersistWatched()) return;
  const sk = movieWatchedStoreKey(profileOrSlot);
  let s: Set<string>;
  if (sk === storeKey() && cache) {
    s = cache;
  } else {
    try {
      const arr = JSON.parse(localStorage.getItem(sk) ?? "[]");
      s = new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : []);
    } catch {
      s = new Set();
    }
  }
  const next = new Set(s);
  if (watched) next.add(metaId);
  else next.delete(metaId);
  localStorage.setItem(sk, JSON.stringify([...next]));
  if (sk === storeKey()) {
    currentScope = sk;
    cache = next;
    version += 1;
    for (const fn of subs) fn();
  }
}

export function subscribeMovieWatched(fn: () => void): () => void {
  subs.add(fn);
  return () => {
    subs.delete(fn);
  };
}

export function movieWatchedVersion(): number {
  return version;
}

export function clearMovieWatched(profileOrSlot?: string | number): void {
  const sk = movieWatchedStoreKey(profileOrSlot);
  try {
    localStorage.removeItem(sk);
    if (profileOrSlot == null) {
      localStorage.removeItem(LEGACY_KEY);
    }
  } catch {}
  currentScope = "";
  cache = null;
  version += 1;
  for (const fn of subs) fn();
}

export function clearAllNuvioMovieWatched(): void {
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k.startsWith("harbor.moviewatched.nuvio.v1.") || k.startsWith("harbor.moviewatched.nuvio."))) {
        toRemove.push(k);
      }
    }
    for (const k of toRemove) localStorage.removeItem(k);
  } catch {}
  currentScope = "";
  cache = null;
  version += 1;
  for (const fn of subs) fn();
}

export function resetMovieWatchedCache(): void {
  currentScope = "";
  cache = null;
  version += 1;
  for (const fn of subs) fn();
}

if (typeof window !== "undefined") {
  const onReset = () => {
    currentScope = "";
    cache = null;
    version += 1;
    for (const fn of subs) fn();
  };
  window.addEventListener("harbor:active-profile-changed", onReset);
  window.addEventListener("harbor:profiles-updated", onReset);
  window.addEventListener("harbor:account-provider-changed", onReset);
  window.addEventListener("harbor:nuvio-profile-changed", onReset);
  window.addEventListener("harbor:nuvio-state-changed", onReset);
  window.addEventListener("harbor:watched-changed", onReset);
}
