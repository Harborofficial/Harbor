import { useSyncExternalStore } from "react";
import { isMovieWatchedLocal, subscribeMovieWatched } from "./movie-watched";
import { persistCritical } from "./storage-recovery";
import { isNuvioProviderActive, getNuvioActiveSlot } from "./active-profile-id";

const KEY_PREFIX = "harbor.watchedFlag.v1.";
const LEGACY_KEY = "harbor.watchedFlag.v1";
const PROFILES_KEY = "harbor.profiles.v1";

const subs = new Set<() => void>();
let version = 0;
let cache: Set<string> | null = null;
let currentScope = "";

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

export function watchedFlagStoreKey(slotOrProfile?: string | number): string {
  if (isNuvioProviderActive()) {
    const slot = slotOrProfile != null ? Number(slotOrProfile) || getNuvioActiveSlot() : getNuvioActiveSlot();
    return `harbor.watchedFlag.nuvio.v1.${slot}`;
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
  if (sk === storeKey()) {
    currentScope = sk;
    cache = next;
    version += 1;
  }
  persistCritical(sk, JSON.stringify([...next]));
  for (const fn of subs) fn();
}

export function isWatchedFlagged(metaId: string): boolean {
  return load().has(metaId);
}

export function watchedFlagIds(): Set<string> {
  return load();
}

const EMPTY_FLAG_IDS: Set<string> = new Set();

export function useWatchedFlagIds(): Set<string> {
  return useSyncExternalStore(subscribe, load, () => EMPTY_FLAG_IDS);
}

export function setWatchedFlag(metaId: string, watched: boolean, profileOrSlot?: string | number): void {
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
  if (s.has(metaId) === watched) return;
  const next = new Set(s);
  if (watched) next.add(metaId);
  else next.delete(metaId);
  persist(next, sk);
}

export function setWatchedFlagAcknowledged(metaId: string, watched: boolean, profileOrSlot?: string | number): void {
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

if (typeof window !== "undefined") {
  let lastScope = storeKey();
  const onScopeChange = () => {
    const nextScope = storeKey();
    if (nextScope === lastScope) return;
    lastScope = nextScope;
    cache = null;
    version += 1;
    for (const fn of subs) fn();
  };
  window.addEventListener("harbor:active-profile-changed", onScopeChange);
  window.addEventListener("harbor:profiles-updated", onScopeChange);
  window.addEventListener("harbor:account-provider-changed", onScopeChange);
  window.addEventListener("harbor:nuvio-profile-changed", onScopeChange);
  window.addEventListener("harbor:nuvio-state-changed", onScopeChange);
}
