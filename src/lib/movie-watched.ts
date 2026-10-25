import { isNuvioProviderActive, getNuvioActiveSlot } from "./active-profile-id";
import { useSyncExternalStore } from "react";
import { persistCritical } from "./storage-recovery";

const KEY_PREFIX = "harbor.moviewatched.v1.";
const LEGACY_KEY = "harbor.moviewatched.v1";
const PROFILES_KEY = "harbor.profiles.v1";

const subs = new Set<() => void>();
let version = 0;
let cache: Set<string> | null = null;

function activeProfileId(): string {
  try {
    const raw = localStorage.getItem(PROFILES_KEY);
    if (!raw) return "";
    const s = JSON.parse(raw) as {
      activeId?: string;
      profiles?: Array<{ id?: string; isPrimary?: boolean; shareStremioWith?: string | null }>;
    };
    const profiles = Array.isArray(s.profiles) ? s.profiles : [];
    const active = profiles.find((p) => p.id === s.activeId) ?? null;
    const own = active?.id ?? profiles.find((p) => p?.isPrimary)?.id ?? "";
    if (!own) return "";
    if (active && typeof active.shareStremioWith === "string" && active.shareStremioWith) {
      const shared = profiles.find((p) => p.id === active.shareStremioWith);
      if (shared?.id) return shared.id;
    }
    return own;
  } catch {
    return "";
  }
}

function primaryProfileId(): string {
  try {
    const raw = localStorage.getItem(PROFILES_KEY);
    const s = raw
      ? (JSON.parse(raw) as { profiles?: Array<{ id?: string; isPrimary?: boolean }> })
      : null;
    const primary = s?.profiles?.find((p) => p?.isPrimary);
    return (primary && typeof primary.id === "string" && primary.id) || activeProfileId();
  } catch {
    return activeProfileId();
  }
}

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
  if (sk === storeKey()) {
    currentScope = sk;
    cache = next;
    version += 1;
  }
  persistCritical(sk, JSON.stringify([...next]));
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

export function clearMovieWatchedMemoryCache(): void {
  cache = null;
  currentScope = "";
  version += 1;
  for (const fn of subs) fn();
}

if (typeof window !== "undefined") {
  let lastScope = storeKey();
  const onScopeChange = () => {
    const nextScope = storeKey();
    if (nextScope === lastScope) return;
    lastScope = nextScope;
    clearMovieWatchedMemoryCache();
  };
  window.addEventListener("harbor:active-profile-changed", onScopeChange);
  window.addEventListener("harbor:profiles-updated", onScopeChange);
  window.addEventListener("harbor:account-provider-changed", onScopeChange);
  window.addEventListener("harbor:nuvio-profile-changed", onScopeChange);
  window.addEventListener("harbor:nuvio-state-changed", () => {
    lastScope = "";
    clearMovieWatchedMemoryCache();
  });
}
