import {
  stremioProfileId as activeProfileId,
  primaryProfileId,
  isNuvioProviderActive,
  nuvioWatchedScope,
  canPersistWatched,
  getNuvioActiveSlot,
} from "./active-profile-id";
import { useSyncExternalStore } from "react";
import { isMovieWatchedLocal, subscribeMovieWatched } from "./movie-watched";
import { persistCritical } from "./storage-recovery";

const KEY_PREFIX = "harbor.watchedFlag.v1.";
const LEGACY_KEY = "harbor.watchedFlag.v1";

const subs = new Set<() => void>();
let version = 0;
let cache: Set<string> | null = null;
let currentScope = "";

export function watchedFlagStoreKey(slotOrProfile?: string | number): string {
  if (isNuvioProviderActive()) {
    const slot =
      slotOrProfile != null ? Number(slotOrProfile) || getNuvioActiveSlot() : getNuvioActiveSlot();
    return `harbor.watchedFlag.${nuvioWatchedScope(slot)}`;
  }
  const id = slotOrProfile ? String(slotOrProfile) : activeProfileId();
  return id ? KEY_PREFIX + id : LEGACY_KEY;
}

function storeKey(): string {
  return watchedFlagStoreKey();
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
export function reconcileNuvioWatchedFlags(
  slot: number,
  serverIds: ReadonlySet<string>,
  accountId: string,
): void {
  if (!accountId) return;
  const key = `harbor.watchedFlag.${nuvioWatchedScope(slot, accountId)}`;
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

export function isWatchedFlagged(metaId: string): boolean {
  const set = load();
  if (set.has(metaId)) return true;
  const clean = metaId.replace(/^(series|movie|tmdb):/, "").trim();
  if (set.has(clean) || set.has(`series:${clean}`) || set.has(`movie:${clean}`)) return true;
  return false;
}

export function watchedFlagIds(): Set<string> {
  return load();
}

const EMPTY_FLAG_IDS: Set<string> = new Set();

export function useWatchedFlagIds(): Set<string> {
  return useSyncExternalStore(subscribe, load, () => EMPTY_FLAG_IDS);
}

export function setWatchedFlag(
  metaId: string,
  watched: boolean,
  profileOrSlot?: string | number,
): void {
  const sk = watchedFlagStoreKey(profileOrSlot);
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
  const clean = metaId.replace(/^(series|movie|tmdb):/, "").trim();
  const variants = Array.from(new Set([metaId, clean, `series:${clean}`, `movie:${clean}`]));
  const next = new Set(s);
  for (const v of variants) {
    if (watched) next.add(v);
    else next.delete(v);
  }
  persist(next, sk);
}

export function setWatchedFlagAcknowledged(
  metaId: string,
  watched: boolean,
  profileOrSlot?: string | number,
): void {
  if (!canPersistWatched()) return;
  const sk = watchedFlagStoreKey(profileOrSlot);
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
  const clean = metaId.replace(/^(series|movie|tmdb):/, "").trim();
  const variants = Array.from(new Set([metaId, clean, `series:${clean}`, `movie:${clean}`]));
  const next = new Set(s);
  for (const v of variants) {
    if (watched) next.add(v);
    else next.delete(v);
  }
  localStorage.setItem(sk, JSON.stringify([...next]));
  if (sk === storeKey()) {
    currentScope = sk;
    cache = next;
    version += 1;
    for (const fn of subs) fn();
  }
}

function subscribe(fn: () => void): () => void {
  subs.add(fn);
  const offMovie = subscribeMovieWatched(fn);
  return () => {
    subs.delete(fn);
    offMovie();
  };
}

export function useMetaWatched(
  metaId: string | undefined,
  type: string | undefined,
  altId?: string | null,
): boolean {
  return useSyncExternalStore(
    subscribe,
    () => {
      if (!metaId) return false;
      if (load().has(metaId)) return true;
      if (altId && load().has(altId)) return true;
      if (type === "movie") {
        if (isMovieWatchedLocal(metaId)) return true;
        if (altId && isMovieWatchedLocal(altId)) return true;
      }
      return false;
    },
    () => false,
  );
}

export function clearWatchedFlags(profileOrSlot?: string | number): void {
  const sk = watchedFlagStoreKey(profileOrSlot);
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

export function clearAllNuvioWatchedFlags(): void {
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (
        k &&
        (k.startsWith("harbor.watchedFlag.nuvio.v1.") || k.startsWith("harbor.watchedFlag.nuvio."))
      ) {
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

export function resetWatchedFlagCache(): void {
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
