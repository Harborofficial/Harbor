import { isAuthenticated } from "./session";
import {
  capturePmdbListOwner,
  changePmdbList,
  clearPmdbListsCache,
  fetchPmdbListItems,
  resolvePmdbList,
  type PmdbListOptions,
} from "./lists";
import type { Meta } from "@/lib/cinemeta";
import type {
  PmdbListItem,
  PmdbTarget,
} from "./types";

export function clearPmdbWatchlistCache(): void {
  clearPmdbListsCache();
}

export async function fetchPmdbWatchlist(
  options: PmdbListOptions = {},
): Promise<PmdbListItem[]> {
  options.assertCurrent?.();
  if (!isAuthenticated()) {
    if (options.strict) throw new Error("PublicMetaDB is disconnected.");
    return [];
  }
  const guard = capturePmdbListOwner(options.assertCurrent);
  try {
    const list = await resolvePmdbList({ ...options, assertCurrent: guard });
    guard();
    return list ? await fetchPmdbListItems(list.id, guard) : [];
  } catch (error) {
    guard();
    if (options.strict) throw error;
    return [];
  }
}

export function pmdbWatchlistContains(
  items: PmdbListItem[],
  target: PmdbTarget,
): PmdbListItem | null {
  if (target.tmdb_id == null) return null;
  return (
    items.find((i) => i.tmdb_id === target.tmdb_id && i.media_type === target.media_type) ?? null
  );
}

/**
 * Maps a watchlist item to a Harbor Meta for grid rendering. The poster
 * field shape is unverified (full URL vs TMDB path vs absent), so all three
 * are handled and title-only cards remain renderable.
 */
export function pmdbWatchlistItemToMeta(item: PmdbListItem): Meta | null {
  if (item.tmdb_id == null) return null;
  const isMovie = item.media_type === "movie";
  let poster: string | undefined;
  const raw = typeof item.poster === "string" ? item.poster.trim() : "";
  if (raw.startsWith("http://") || raw.startsWith("https://")) {
    poster = raw;
  } else if (raw.startsWith("/") && raw.length > 1) {
    poster = `https://image.tmdb.org/t/p/w500${raw}`;
  }
  return {
    id: isMovie ? `tmdb:movie:${item.tmdb_id}` : `tmdb:tv:${item.tmdb_id}`,
    type: isMovie ? "movie" : "series",
    name: item.title || (isMovie ? `Movie (${item.tmdb_id})` : `Series (${item.tmdb_id})`),
    releaseInfo: item.year != null ? String(item.year) : undefined,
    poster,
  };
}

export async function addToPmdbWatchlist(
  target: PmdbTarget,
  options: PmdbListOptions = {},
): Promise<boolean> {
  options.assertCurrent?.();
  if (!isAuthenticated()) return false;
  // Add-to-list takes tmdb_id + media_type only; resolve first, never send
  // ID-only targets the server must reject.
  if (target.tmdb_id == null) return false;
  const guard = capturePmdbListOwner(options.assertCurrent);
  try {
    await changePmdbList(target, true, { ...options, assertCurrent: guard });
    return true;
  } catch (error) {
    guard();
    if (options.strict) throw error;
    return false;
  }
}

export async function removeFromPmdbWatchlist(
  target: PmdbTarget,
  options: PmdbListOptions = {},
): Promise<boolean> {
  options.assertCurrent?.();
  if (!isAuthenticated()) return false;
  if (target.tmdb_id == null) return false;
  const guard = capturePmdbListOwner(options.assertCurrent);
  try {
    await changePmdbList(target, false, { ...options, assertCurrent: guard });
    return true;
  } catch (error) {
    guard();
    if (options.strict) throw error;
    return false;
  }
}
