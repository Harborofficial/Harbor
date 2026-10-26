import {
  isNuvioProviderActive,
  nuvioWatchedScope,
  canPersistWatched,
  stremioProfileId as activeProfileId,
  primaryProfileId,
} from "./active-profile-id";
import { useSyncExternalStore } from "react";
import { persistCritical } from "./storage-recovery";

const KEY_PREFIX = "harbor.moviewatched.v1.";
const LEGACY_KEY = "harbor.moviewatched.v1";

const subs = new Set<() => void>();
let version = 0;
let cache: Set<string> | null = null;

function storeKey(): string {
  if (isNuvioProviderActive()) {
    return `harbor.moviewatched.${nuvioWatchedScope()}`;
  }
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

function persist(next: Set<string>): void {
  if (!canPersistWatched()) return;
  const sk = storeKey();
  currentScope = sk;
  cache = next;
  version += 1;
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

export function isMovieWatchedLocal(metaId: string): boolean {
  return load().has(metaId);
}

export function movieWatchedIds(): Set<string> {
  return load();
}

const EMPTY_MOVIE_WATCHED_IDS: Set<string> = new Set();

export function useMovieWatchedIds(): Set<string> {
  return useSyncExternalStore(subscribeMovieWatched, load, () => EMPTY_MOVIE_WATCHED_IDS);
}

export function setMovieWatchedLocal(metaId: string, watched: boolean): void {
  const cur = load();
  if (cur.has(metaId) === watched) return;
  const next = new Set(cur);
  if (watched) next.add(metaId);
  else next.delete(metaId);
  persist(next);
}

export function setMovieWatchedLocalAcknowledged(metaId: string, watched: boolean): void {
  if (!canPersistWatched()) return;
  const next = new Set(load());
  if (watched) next.add(metaId);
  else next.delete(metaId);
  localStorage.setItem(storeKey(), JSON.stringify([...next]));
  cache = next;
  version += 1;
  for (const fn of subs) fn();
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
