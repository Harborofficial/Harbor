import { useEffect, useMemo, useState } from "react";
import {
  addToWatchlist as traktAdd,
  removeFromWatchlist as traktRemove,
} from "@/lib/trakt/watchlist";
import { stremioIdToTraktTarget } from "@/lib/trakt/ids";
import {
  addToWatchlist as simklAdd,
  removeFromWatchlist as simklRemove,
} from "@/lib/simkl/watchlist";
import { stremioIdToSimklTarget } from "@/lib/simkl/ids";
import { isAuthenticated as simklConnected } from "@/lib/simkl/session";
import { setItemWithRecovery, freeStorageSpace } from "@/lib/storage-recovery";
import {
  ANIME_CLOUD_ID,
  cloudWriteId,
  saveStremioBookmark,
  removeStremioBookmark,
} from "@/lib/stremio";
import { readActiveStremioAuthKey } from "@/lib/auth";
import { cloudReachOf, watchlistImdbId } from "@/lib/watchlist-cloud-id";
import { persistableAddonOrigin, persistableVideos, type Meta } from "@/lib/cinemeta";
import { isNuvioProviderActive, resolveNuvioProfileIndex } from "@/lib/nuvio/nuvio-sync";
import {
  addNuvioLibraryItem,
  removeNuvioLibraryItem,
  flushNuvioLibraryMutations,
  readCachedNuvioLibrary,
  isNuvioItemInLibrary,
} from "@/lib/nuvio/nuvio-library";

const KEY_PREFIX = "harbor.watchlist.v1.";
const LEGACY_KEY = "harbor.watchlist.v1";
const AGG_KEY_PREFIX = "harbor.watchlist.aggregate.v1.";
const LEGACY_AGG_KEY = "harbor.watchlist.aggregate.v1";
const PROFILES_KEY = "harbor.profiles.v1";
const subs = new Set<() => void>();

export type LocalEntry = {
  id: string;
  type: "movie" | "series";
  name: string;
  poster?: string;
  addedAt: number;
  imdbId?: string | null;
  addonOrigin?: Meta["addonOrigin"];
  videos?: Meta["videos"];
};

export type WatchlistInput = {
  id: string;
  type?: string;
  name?: string;
  poster?: string;
  imdbId?: string | null;
  background?: string | null;
  logo?: string | null;
  description?: string | null;
  releaseInfo?: string | null;
  imdbRating?: number | string | null;
  genres?: string[];
  posterShape?: "POSTER" | "SQUARE" | "LANDSCAPE";
  addonOrigin?: Meta["addonOrigin"];
  videos?: Meta["videos"];
};

let memoryFallback: Map<string, LocalEntry> | null = null;

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

function storeKey(): string {
  if (isNuvioProviderActive()) {
    const slot = resolveNuvioProfileIndex();
    return `${KEY_PREFIX}nuvio.slot.${slot}`;
  }
  const id = activeProfileId();
  return id ? KEY_PREFIX + id : LEGACY_KEY;
}

function aggStoreKey(): string {
  if (isNuvioProviderActive()) {
    const slot = resolveNuvioProfileIndex();
    return `${AGG_KEY_PREFIX}nuvio.slot.${slot}`;
  }
  const id = activeProfileId();
  return id ? AGG_KEY_PREFIX + id : LEGACY_AGG_KEY;
}

function migrateLegacy(): void {
  if (isNuvioProviderActive()) return;
  try {
    const pid = primaryProfileId();
    if (!pid) return;
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const perKey = KEY_PREFIX + pid;
      if (!localStorage.getItem(perKey)) localStorage.setItem(perKey, legacy);
      localStorage.removeItem(LEGACY_KEY);
    }
    const legacyAgg = localStorage.getItem(LEGACY_AGG_KEY);
    if (legacyAgg) {
      const perKey = AGG_KEY_PREFIX + pid;
      if (!localStorage.getItem(perKey)) localStorage.setItem(perKey, legacyAgg);
      localStorage.removeItem(LEGACY_AGG_KEY);
    }
  } catch {
    /* noop */
  }
}

function inferType(id: string): "movie" | "series" {
  return id.includes(":tv:") || id.includes(":series:") ? "series" : "movie";
}

function validTt(v: unknown): string | null {
  return typeof v === "string" && /^tt\d+$/.test(v) ? v : null;
}

function normalizeType(type: string | undefined, id: string): "movie" | "series" {
  if (type === "series" || type === "tv") return "series";
  if (type === "movie") return "movie";
  return inferType(id);
}

function toEntry(input: string | WatchlistInput): LocalEntry {
  if (typeof input === "string") {
    return { id: input, type: inferType(input), name: "", addedAt: Date.now(), imdbId: null };
  }
  return {
    id: input.id,
    type: normalizeType(input.type, input.id),
    name: input.name ?? "",
    poster: input.poster,
    addedAt: Date.now(),
    imdbId: validTt(input.imdbId),
    addonOrigin: persistableAddonOrigin(input.addonOrigin),
    videos: persistableVideos(input.videos),
  };
}

function read(): Map<string, LocalEntry> {
  if (isNuvioProviderActive()) {
    const slot = resolveNuvioProfileIndex();
    const nuvio = readCachedNuvioLibrary(slot);
    const map = new Map<string, LocalEntry>();
    for (const item of nuvio) {
      if (item && item.content_id) {
        map.set(item.content_id, {
          id: item.content_id,
          type: item.content_type === "series" ? "series" : "movie",
          name: item.name,
          poster: item.poster || undefined,
          addedAt: item.added_at,
          imdbId: validTt(item.content_id),
        });
      }
    }
    return map;
  }
  if (memoryFallback) return new Map(memoryFallback);
  migrateLegacy();
  const map = new Map<string, LocalEntry>();
  try {
    const raw = localStorage.getItem(storeKey());
    if (!raw) return map;
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return map;
    for (const el of arr) {
      if (typeof el === "string") {
        map.set(el, { id: el, type: inferType(el), name: "", addedAt: 0, imdbId: null });
      } else if (el && typeof el === "object" && typeof (el as { id?: unknown }).id === "string") {
        const e = el as {
          id: string;
          type?: string;
          name?: string;
          poster?: string;
          addedAt?: number;
          imdbId?: unknown;
          addonOrigin?: unknown;
          videos?: unknown;
        };
        map.set(e.id, {
          id: e.id,
          type: e.type === "series" ? "series" : "movie",
          name: typeof e.name === "string" ? e.name : "",
          poster: typeof e.poster === "string" ? e.poster : undefined,
          addedAt: typeof e.addedAt === "number" ? e.addedAt : 0,
          imdbId: validTt(e.imdbId),
          addonOrigin: persistableAddonOrigin(e.addonOrigin),
          videos: persistableVideos(e.videos),
        });
      }
    }
  } catch {
    return new Map();
  }
  return map;
}

function write(map: Map<string, LocalEntry>) {
  if (isNuvioProviderActive()) {
    try {
      localStorage.setItem(storeKey(), JSON.stringify(Array.from(map.values())));
    } catch {}
    for (const s of subs) s();
    return;
  }
  const payload = JSON.stringify(Array.from(map.values()));
  const ok = setItemWithRecovery(storeKey(), payload);
  if (!ok) {
    freeStorageSpace();
    const retry = setItemWithRecovery(storeKey(), payload);
    if (!retry) {
      memoryFallback = new Map(map);
      console.warn("[watchlist] localStorage exhausted, holding watchlist in memory only");
    } else {
      memoryFallback = null;
    }
  } else {
    memoryFallback = null;
  }
  for (const s of subs) s();
}

export function readLocalEntries(): LocalEntry[] {
  if (isNuvioProviderActive()) {
    const slot = resolveNuvioProfileIndex();
    const nuvio = readCachedNuvioLibrary(slot);
    return nuvio.map((item) => ({
      id: item.content_id,
      type: item.content_type === "series" ? "series" : "movie",
      name: item.name,
      poster: item.poster || undefined,
      addedAt: item.added_at,
      imdbId: validTt(item.content_id),
    }));
  }
  return Array.from(read().values());
}

export function subscribeWatchlist(fn: () => void): () => void {
  subs.add(fn);
  return () => {
    subs.delete(fn);
  };
}

let aggregateIds: Set<string> = readAggregateCache();

function readAggregateCache(): Set<string> {
  migrateLegacy();
  try {
    const raw = localStorage.getItem(aggStoreKey());
    const baseSet = new Set<string>();
    if (raw) {
      const arr = JSON.parse(raw) as unknown;
      if (Array.isArray(arr)) {
        for (const v of arr) if (typeof v === "string") baseSet.add(v);
      }
    }
    if (isNuvioProviderActive()) {
      const slot = resolveNuvioProfileIndex();
      const nuvioItems = readCachedNuvioLibrary(slot);
      for (const it of nuvioItems) {
        if (it.content_id) baseSet.add(it.content_id);
      }
    }
    return baseSet;
  } catch {
    return new Set();
  }
}

function writeAggregateCache(set: Set<string>) {
  try {
    localStorage.setItem(aggStoreKey(), JSON.stringify(Array.from(set)));
  } catch {
    /* swallow */
  }
}

export function setWatchlistAggregate(ids: Iterable<string>): void {
  const next = new Set(ids);
  // Library refreshes publish here and watchlist subscribers refresh the library.
  // Do not turn an unchanged server response into another refresh cycle.
  if (next.size === aggregateIds.size && [...next].every((id) => aggregateIds.has(id))) return;
  aggregateIds = next;
  writeAggregateCache(aggregateIds);
  for (const s of subs) s();
}

export function clearWatchlistCache(profileOrSlot?: string | number): void {
  try {
    if (profileOrSlot != null) {
      localStorage.removeItem(`${AGG_KEY_PREFIX}${profileOrSlot}`);
    } else {
      localStorage.removeItem(LEGACY_AGG_KEY);
      localStorage.removeItem(aggStoreKey());
    }
  } catch {}
  aggregateIds = new Set();
  for (const s of subs) s();
}

export function watchlistHas(id: string): boolean {
  if (isNuvioProviderActive()) {
    const slot = resolveNuvioProfileIndex();
    return isNuvioItemInLibrary(slot, id);
  }
  return read().has(id) || aggregateIds.has(id);
}

export function watchlistAllIds(): string[] {
  const out = new Set<string>(read().keys());
  for (const id of aggregateIds) out.add(id);
  return Array.from(out);
}

export function addToWatchlist(input: string | WatchlistInput): void {
  const map = read();
  const entry = toEntry(input);
  map.set(entry.id, entry);
  write(map);
}

export function noteLocalImdbId(id: string, imdbId: string | null | undefined): void {
  const tt = validTt(imdbId);
  if (!tt || tt === id) return;
  const map = read();
  const e = map.get(id);
  if (!e || e.imdbId === tt) return;
  e.imdbId = tt;
  write(map);
}

export function evictWatchlistAggregate(ids: Iterable<string>): void {
  let changed = false;
  for (const id of ids) {
    if (aggregateIds.delete(id)) changed = true;
  }
  if (!changed) return;
  writeAggregateCache(aggregateIds);
  for (const s of subs) s();
}

export function removeFromWatchlist(id: string): void {
  const map = read();
  map.delete(id);
  aggregateIds.delete(id);
  writeAggregateCache(aggregateIds);
  write(map);
}

/** Explicit local commit; callers decide when confirmed remote aggregate entries can be cleared. */
export function setLocalWatchlistAcknowledged(input: WatchlistInput, on: boolean): void {
  const key = storeKey();
  const raw = localStorage.getItem(key);
  const existing: unknown = raw == null ? [] : JSON.parse(raw);
  if (
    !Array.isArray(existing) ||
    !existing.every((entry) => typeof entry === "string" || (entry && typeof entry.id === "string"))
  )
    throw new Error("The saved watchlist could not be read.");
  const map = read();
  if (on) {
    if (!map.has(input.id)) map.set(input.id, toEntry(input));
  } else {
    map.delete(input.id);
    if (input.imdbId) map.delete(input.imdbId);
  }
  const payload = JSON.stringify([...map.values()]);
  localStorage.setItem(key, payload);
  if (localStorage.getItem(key) !== payload) throw new Error("The watchlist was not saved.");
  memoryFallback = null;
  for (const listener of subs) listener();
}

export function clearWatchlistAggregate(input: WatchlistInput): void {
  const next = new Set(aggregateIds);
  next.delete(input.id);
  if (input.imdbId) next.delete(input.imdbId);
  localStorage.setItem(aggStoreKey(), JSON.stringify([...next]));
  aggregateIds = next;
  for (const listener of subs) listener();
}

export function removeFromWatchlistEntry(input: string | WatchlistInput): void {
  const map = read();
  const rawId = typeof input === "string" ? input : input.id;
  const rawImdb = typeof input === "string" ? null : (input.imdbId ?? null);
  const id = typeof rawId === "string" ? rawId.trim() : "";
  const imdb = typeof rawImdb === "string" ? rawImdb.trim() : null;
  if (!id) return;
  const targets = new Set<string>();
  targets.add(id);
  if (imdb) targets.add(imdb);
  for (const t of targets) map.delete(t);
  write(map);
  for (const t of targets) aggregateIds.delete(t);
  writeAggregateCache(aggregateIds);
  void syncWithTrakt(id, false);
  void syncWithSimkl(id, false);
  if (isNuvioProviderActive()) {
    void syncWithNuvio(input, false);
  } else {
    void syncWithStremio(input, false);
  }
}

export function toggleWatchlist(input: string | WatchlistInput): boolean {
  const map = read();
  const id = typeof input === "string" ? input : input.id;
  const imdb = typeof input === "string" ? null : (input.imdbId ?? null);
  const has = map.has(id) || aggregateIds.has(id) || (!!imdb && aggregateIds.has(imdb));
  if (has) {
    // Same film can be stored under two ID schemes (tmdb:… locally, tt… on
    // Stremio); both must go or the card survives the removal.
    const targets = new Set<string>([id]);
    if (imdb) targets.add(imdb);
    for (let pass = 0; pass < 3; pass++) {
      let grew = false;
      for (const [k, e] of map) {
        if (targets.has(k) || (e.imdbId != null && targets.has(e.imdbId))) {
          if (!targets.has(k)) {
            targets.add(k);
            grew = true;
          }
          if (e.imdbId != null && !targets.has(e.imdbId)) {
            targets.add(e.imdbId);
            grew = true;
          }
        }
      }
      if (!grew) break;
    }
    for (const t of targets) {
      map.delete(t);
      aggregateIds.delete(t);
    }
    writeAggregateCache(aggregateIds);
  } else {
    map.set(id, toEntry(input));
  }
  write(map);
  void syncWithTrakt(id, !has);
  void syncWithSimkl(id, !has);
  if (isNuvioProviderActive()) {
    void syncWithNuvio(input, !has);
  } else {
    void syncWithStremio(input, !has);
  }
  return !has;
}

async function syncWithTrakt(metaId: string, added: boolean): Promise<void> {
  try {
    const r = stremioIdToTraktTarget(metaId);
    if (!r.ok) return;
    if (added) await traktAdd(r.target);
    else await traktRemove(r.target);
  } catch {
    /* swallow */
  }
}

async function syncWithSimkl(metaId: string, added: boolean): Promise<void> {
  try {
    if (!simklConnected()) return;
    const r = stremioIdToSimklTarget(metaId);
    if (!r.ok) return;
    if (added) await simklAdd(r.target);
    else await simklRemove(r.target);
  } catch {
    /* swallow */
  }
}

async function syncWithStremio(input: string | WatchlistInput, added: boolean): Promise<void> {
  const authKey = readActiveStremioAuthKey();
  if (!authKey) return;
  const id = typeof input === "string" ? input : input.id;
  const imdb = typeof input === "string" ? null : (input.imdbId ?? null);
  try {
    if (added) {
      const resolved = imdb ?? (await watchlistImdbId(id));
      const writeId = cloudWriteId(id, resolved, !!resolved);
      if (!writeId) {
        console.warn(`[watchlist] ${id} stays local only (${cloudReachOf(id, writeId)})`);
        return;
      }
      const meta =
        typeof input === "string"
          ? {}
          : { type: input.type, name: input.name, poster: input.poster };
      await saveStremioBookmark(authKey, writeId, meta);
      // The server id often differs from the local key (tt… vs tmdb:…);
      // without this the badge/button checks never see the added title.
      aggregateIds.add(writeId);
      writeAggregateCache(aggregateIds);
      for (const s of subs) s();
    } else {
      const forms = new Set<string>();
      const resolved = imdb ?? (await watchlistImdbId(id));
      const withImdb = cloudWriteId(id, resolved, !!resolved);
      const withMeta = cloudWriteId(id, resolved, false);
      if (withImdb) forms.add(withImdb);
      if (withMeta) forms.add(withMeta);
      if (ANIME_CLOUD_ID.test(id)) forms.add(id);
      for (const rid of forms) {
        await removeStremioBookmark(authKey, rid);
        aggregateIds.delete(rid);
      }
      writeAggregateCache(aggregateIds);
      for (const s of subs) s();
    }
  } catch (e) {
    console.warn("[watchlist] stremio sync failed", e);
  }
}

async function syncWithNuvio(input: string | WatchlistInput, added: boolean): Promise<void> {
  const slot = resolveNuvioProfileIndex();
  const rawId = typeof input === "string" ? input : input.id;
  const id = typeof rawId === "string" ? rawId.trim() : "";
  if (!id) return;

  const rawImdb = typeof input === "string" ? null : (input.imdbId ?? null);
  const imdb = typeof rawImdb === "string" && rawImdb.trim().length > 0 ? rawImdb.trim() : null;
  const type = typeof input === "string" ? inferType(input) : normalizeType(input.type, input.id);
  const name = typeof input === "string" ? "" : (input.name ?? "");
  const poster = typeof input === "string" ? null : (input.poster ?? null);
  const background = typeof input === "string" ? null : (input.background ?? null);
  const logo = typeof input === "string" ? null : (input.logo ?? null);
  const description = typeof input === "string" ? null : (input.description ?? null);
  const releaseInfo = typeof input === "string" ? null : (input.releaseInfo ?? null);
  const imdbRating =
    typeof input === "string"
      ? null
      : input.imdbRating != null
        ? parseFloat(String(input.imdbRating)) || null
        : null;
  const genres = typeof input !== "string" && Array.isArray(input.genres) ? input.genres : [];
  const posterShape = typeof input !== "string" && input.posterShape ? input.posterShape : "POSTER";

  try {
    if (added) {
      addNuvioLibraryItem(slot, {
        content_id: id,
        content_type: type,
        name,
        poster,
        poster_shape: posterShape,
        background,
        logo,
        description,
        release_info: releaseInfo,
        imdb_rating: imdbRating,
        genres,
        added_at: Date.now(),
      });
      aggregateIds.add(id);
      if (imdb) aggregateIds.add(imdb);
      writeAggregateCache(aggregateIds);
      for (const s of subs) s();
      void flushNuvioLibraryMutations(slot);
    } else {
      removeNuvioLibraryItem(slot, id, type);
      if (imdb && imdb !== id) {
        removeNuvioLibraryItem(slot, imdb, type);
      }
      aggregateIds.delete(id);
      if (imdb) aggregateIds.delete(imdb);
      writeAggregateCache(aggregateIds);
      for (const s of subs) s();
      void flushNuvioLibraryMutations(slot);
    }
  } catch (e) {
    console.warn("[watchlist] nuvio sync failed", e);
  }
}

export function useInWatchlist(
  id: string | undefined,
  altIds?: Array<string | null | undefined>,
): boolean {
  const candidates = useMemo(() => {
    const arr: string[] = [];
    if (id) arr.push(id);
    if (altIds) for (const a of altIds) if (a) arr.push(a);
    return arr;
  }, [id, altIds?.join("|")]);

  const check = () => {
    if (candidates.length === 0) return false;
    const local = read();
    return candidates.some((c) => local.has(c) || aggregateIds.has(c));
  };

  const [has, setHas] = useState<boolean>(check);
  useEffect(() => {
    setHas(check());
    const tick = () => setHas(check());
    subs.add(tick);
    return () => {
      subs.delete(tick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidates.join("|")]);
  return has;
}

if (typeof window !== "undefined") {
  const currentToken = () =>
    isNuvioProviderActive() ? `nuvio-${resolveNuvioProfileIndex()}` : activeProfileId();

  let lastProfile = currentToken();
  const onProfileChange = () => {
    const p = currentToken();
    if (p === lastProfile) return;
    lastProfile = p;
    memoryFallback = null;
    aggregateIds = readAggregateCache();
    for (const s of subs) s();
  };
  window.addEventListener("harbor:active-profile-changed", onProfileChange);
  window.addEventListener("harbor:profiles-updated", onProfileChange);
  window.addEventListener("harbor:nuvio-profile-changed", onProfileChange);
  window.addEventListener("harbor:nuvio-state-changed", onProfileChange);
  window.addEventListener("harbor:nuvio-library-changed", () => {
    aggregateIds = readAggregateCache();
    for (const s of subs) s();
  });
}
