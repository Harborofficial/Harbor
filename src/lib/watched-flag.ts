import {
  stremioProfileId as activeProfileId,
  primaryProfileId,
  isNuvioProviderActive,
  nuvioWatchedScope,
  canPersistWatched,
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

function storeKey(): string {
  if (isNuvioProviderActive()) return `harbor.watchedFlag.${nuvioWatchedScope()}`;
  const id = activeProfileId();
  return id ? KEY_PREFIX + id : LEGACY_KEY;
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
  const scope = storeKey();
  if (cache && currentScope === scope) return cache;
  currentScope = scope;
  migrateLegacy();
  try {
    const arr = JSON.parse(localStorage.getItem(scope) ?? "[]");
    cache = new Set(
      Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : [],
    );
  } catch {
    cache = new Set();
  }
  return cache;
}

function persist(next: Set<string>): void {
  if (!canPersistWatched()) return;
  currentScope = storeKey();
  cache = next;
  version += 1;
  persistCritical(storeKey(), JSON.stringify([...next]));
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
  return load().has(metaId);
}

export function watchedFlagIds(): Set<string> {
  return load();
}

const EMPTY_FLAG_IDS: Set<string> = new Set();

export function useWatchedFlagIds(): Set<string> {
  return useSyncExternalStore(subscribe, load, () => EMPTY_FLAG_IDS);
}

export function setWatchedFlag(metaId: string, watched: boolean): void {
  const cur = load();
  if (cur.has(metaId) === watched) return;
  const next = new Set(cur);
  if (watched) next.add(metaId);
  else next.delete(metaId);
  persist(next);
}

export function setWatchedFlagAcknowledged(metaId: string, watched: boolean): void {
  if (!canPersistWatched()) return;
  const next = new Set(load());
  if (watched) next.add(metaId);
  else next.delete(metaId);
  localStorage.setItem(storeKey(), JSON.stringify([...next]));
  currentScope = storeKey();
  cache = next;
  version += 1;
  for (const fn of subs) fn();
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
  let lastProfile = storeKey();
  const onProfileChange = () => {
    const p = storeKey();
    if (p === lastProfile) return;
    lastProfile = p;
    cache = null;
    version += 1;
    for (const fn of subs) fn();
  };
  window.addEventListener("harbor:active-profile-changed", onProfileChange);
  window.addEventListener("harbor:profiles-updated", onProfileChange);
  window.addEventListener("harbor:account-provider-changed", onProfileChange);
  window.addEventListener("harbor:nuvio-profile-changed", onProfileChange);
  window.addEventListener("harbor:nuvio-state-changed", onProfileChange);
}
