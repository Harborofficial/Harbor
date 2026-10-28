import { activeProfileId } from "@/lib/active-profile-id";
import { pmdbRequest, PmdbApiError } from "./client";
import { getSession, subscribeSession } from "./session";
import type { PmdbList, PmdbListItem, PmdbSession, PmdbTarget } from "./types";

export type PmdbListOptions = {
  listId?: string | null;
  strict?: boolean;
  assertCurrent?: () => void;
};

export class PmdbListError extends Error {
  reason: "read" | "missing" | "create" | "add" | "remove";

  constructor(reason: PmdbListError["reason"]) {
    super({
      read: "Couldn't load PublicMetaDB lists. Try refreshing.",
      missing: "This PublicMetaDB list is unavailable. Choose another list in Library.",
      create: "Couldn't create your PublicMetaDB watchlist. Try again.",
      add: "Couldn't add this title to the PublicMetaDB list. Try again.",
      remove: "Couldn't remove this title from the PublicMetaDB list. Try again.",
    }[reason]);
    this.name = "PmdbListError";
    this.reason = reason;
  }
}

export function pmdbListErrorMessage(error: unknown): string {
  if (error instanceof PmdbListError) return error.message;
  if (error instanceof DOMException && error.name === "AbortError")
    return "PublicMetaDB account changed. Try again.";
  return "Couldn't load PublicMetaDB lists. Try refreshing.";
}

const subscribers = new Set<() => void>();
let version = 0;
let cached: { profile: string; session: PmdbSession; lists: PmdbList[] } | null = null;
let creating: { profile: string; session: PmdbSession; promise: Promise<PmdbList> } | null = null;

function emit(): void {
  version += 1;
  for (const fn of subscribers) fn();
}

export const getPmdbListsVersion = () => version;
export function subscribePmdbLists(fn: () => void): () => void {
  subscribers.add(fn);
  return () => { subscribers.delete(fn); };
}

function preferenceKey(): string {
  return `harbor.publicmetadb.default-list.v1.${activeProfileId()}`;
}

export function getPmdbDefaultListId(): string | null {
  try { return localStorage.getItem(preferenceKey()) || null; } catch { return null; }
}

export function setPmdbDefaultListId(id: string | null): void {
  if (id) localStorage.setItem(preferenceKey(), id);
  else localStorage.removeItem(preferenceKey());
  emit();
}

export function clearPmdbListsCache(): void {
  cached = null;
}

export function notifyPmdbListsChanged(): void {
  clearPmdbListsCache();
  emit();
}

subscribeSession(notifyPmdbListsChanged);

export function capturePmdbListOwner(assertCurrent?: () => void): () => void {
  const profile = activeProfileId();
  const session = getSession();
  return () => {
    assertCurrent?.();
    if (!session || activeProfileId() !== profile || getSession() !== session)
      throw new DOMException("PublicMetaDB list operation cancelled after account change", "AbortError");
  };
}

async function readPages<T extends { id: string }>(path: string, guard: () => void): Promise<T[]> {
  const out: T[] = [];
  const seen = new Set<string>();
  for (let page = 1; page <= 100; page++) {
    guard();
    const res = await pmdbRequest<{ items: T[]; total?: number; totalPages?: number }>(
      `${path}?page=${page}&perPage=100`, { method: "GET" },
    );
    guard();
    if (!Array.isArray(res?.items)) throw new PmdbListError("read");
    for (const item of res.items) {
      if (!item || typeof item.id !== "string" || !item.id || seen.has(item.id))
        throw new PmdbListError("read");
      seen.add(item.id);
      out.push(item);
    }
    const total = typeof res.total === "number" && Number.isFinite(res.total) ? res.total : null;
    if (total !== null && out.length >= total) return out;
    if (res.items.length === 0 || (res.totalPages != null && page >= res.totalPages)) {
      if (total !== null && out.length < total) throw new PmdbListError("read");
      return out;
    }
    if (total === null && res.totalPages == null && res.items.length < 100) return out;
  }
  throw new PmdbListError("read");
}

export async function fetchPmdbLists(
  options: { refresh?: boolean; assertCurrent?: () => void } = {},
): Promise<PmdbList[]> {
  const guard = capturePmdbListOwner(options.assertCurrent);
  guard();
  const session = getSession()!;
  const profile = activeProfileId();
  if (!options.refresh && cached?.profile === profile && cached.session === session) return cached.lists;
  try {
    const lists = await readPages<PmdbList>("/api/external/lists", guard);
    if (lists.some((list) => list.type !== "watchlist" && list.type !== "custom"))
      throw new PmdbListError("read");
    cached = { profile, session, lists };
    return lists;
  } catch (error) {
    guard();
    if (error instanceof PmdbListError) throw error;
    throw new PmdbListError("read");
  }
}

export async function resolvePmdbList(options: PmdbListOptions = {}): Promise<PmdbList | null> {
  const id = options.listId === undefined ? getPmdbDefaultListId() : options.listId;
  const lists = await fetchPmdbLists({ refresh: options.strict, assertCurrent: options.assertCurrent });
  if (id) {
    const list = lists.find((list) => list.id === id);
    if (!list) throw new PmdbListError("missing");
    return list;
  }
  return lists.find((list) => list.type === "watchlist") ?? null;
}

export async function fetchPmdbListItems(listId: string, assertCurrent?: () => void): Promise<PmdbListItem[]> {
  const guard = capturePmdbListOwner(assertCurrent);
  try {
    const items = await readPages<PmdbListItem>(`/api/external/lists/${encodeURIComponent(listId)}/items`, guard);
    if (items.some((item) => (item.list_id != null && item.list_id !== listId) ||
      !Number.isFinite(item.tmdb_id) || (item.media_type !== "movie" && item.media_type !== "tv")))
      throw new PmdbListError("read");
    return items.map((item) => ({ ...item, list_id: listId }));
  } catch (error) {
    guard();
    if (error instanceof PmdbApiError && error.status === 404) throw new PmdbListError("missing");
    throw new PmdbListError("read");
  }
}

async function ensureWatchlist(): Promise<PmdbList> {
  const guard = capturePmdbListOwner();
  guard();
  const profile = activeProfileId();
  const session = getSession()!;
  if (creating?.profile === profile && creating.session === session) return creating.promise;
  const promise = (async () => {
    const existing = await resolvePmdbList({ listId: null, strict: true, assertCurrent: guard });
    if (existing) return existing;
    try {
      guard();
      const res = await pmdbRequest<{ item?: PmdbList }>("/api/external/lists", {
        method: "POST", body: { name: "Watchlist", type: "watchlist", is_public: false },
      });
      guard();
      if (!res?.item?.id || res.item.type !== "watchlist") throw new PmdbListError("create");
      notifyPmdbListsChanged();
      return res.item;
    } catch (error) {
      guard();
      // The website or another client may have initialized the watchlist meanwhile.
      if (error instanceof PmdbApiError && error.status === 409) {
        const existing = await resolvePmdbList({ listId: null, strict: true, assertCurrent: guard });
        if (existing) return existing;
      }
      throw new PmdbListError("create");
    }
  })();
  const operation = { profile, session, promise };
  creating = operation;
  try { return await promise; } finally { if (creating === operation) creating = null; }
}

export async function changePmdbList(
  target: PmdbTarget, add: boolean, options: PmdbListOptions = {},
): Promise<void> {
  const guard = capturePmdbListOwner(options.assertCurrent);
  guard();
  const listId = options.listId === undefined ? getPmdbDefaultListId() : options.listId;
  let list = await resolvePmdbList({ ...options, listId, assertCurrent: guard });
  guard();
  if (!list && add) list = await ensureWatchlist();
  guard();
  if (!list) return;
  const path = `/api/external/lists/${encodeURIComponent(list.id)}/items`;
  try {
    if (add) {
      guard();
      const res = await pmdbRequest<{ success?: boolean } | undefined>(path, {
        method: "POST", body: { tmdb_id: target.tmdb_id, media_type: target.media_type },
      });
      if (res?.success === false) throw new PmdbListError("add");
    } else {
      const items = await fetchPmdbListItems(list.id, guard);
      const item = items.find((item) => item.tmdb_id === target.tmdb_id && item.media_type === target.media_type);
      if (!item) return;
      guard();
      const res = await pmdbRequest<{ success?: boolean } | undefined>(`${path}/${encodeURIComponent(item.id)}`, { method: "DELETE" });
      if (res?.success === false) throw new PmdbListError("remove");
    }
    guard();
    notifyPmdbListsChanged();
  } catch (error) {
    guard();
    if (error instanceof PmdbListError) throw error;
    if (error instanceof PmdbApiError && error.status === 404) throw new PmdbListError("missing");
    throw new PmdbListError(add ? "add" : "remove");
  }
}
