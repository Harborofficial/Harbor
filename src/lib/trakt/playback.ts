import { traktRequest, traktRequestWithResponse, TraktApiError } from "./client";
import { getSession } from "./session";
import { isCwDismissed } from "@/lib/cw-dismiss";
import { readResumeEntry, saveResumeMs } from "@/lib/resume";
import type { LibraryItem } from "@/lib/stremio";
import type { TraktIds } from "./types";

type Node = { title?: string; year?: number | null; ids?: TraktIds };

type RawPlayback = {
  id?: number | string;
  progress?: number;
  paused_at?: string;
  type?: "movie" | "episode";
  movie?: Node;
  show?: Node;
  episode?: { season?: number; number?: number; title?: string; ids?: TraktIds };
};

const DURATION_MS = { movie: 6_300_000, series: 2_640_000 };

function movieMetaId(ids?: TraktIds): string | null {
  if (!ids) return null;
  const imdb = ids.imdb ? String(ids.imdb).trim().toLowerCase() : null;
  if (imdb && /^tt\d+$/.test(imdb)) return imdb;
  if (ids.tmdb) return `tmdb:movie:${ids.tmdb}`;
  return null;
}

function seriesMetaId(ids?: TraktIds): string | null {
  if (!ids) return null;
  const imdb = ids.imdb ? String(ids.imdb).trim().toLowerCase() : null;
  if (imdb && /^tt\d+$/.test(imdb)) return imdb;
  if (ids.tmdb) return `tmdb:tv:${ids.tmdb}`;
  return null;
}

function buildItem(
  id: string,
  type: "movie" | "series",
  node: Node,
  pct: number,
  durMs: number,
  when: string,
  season?: number,
  episode?: number,
): LibraryItem {
  const hasEpisode =
    type === "series" && season != null && season >= 0 && episode != null && episode >= 0;
  return {
    _id: id,
    type,
    name: node.title ?? "Untitled",
    state: {
      timeOffset: Math.round((pct / 100) * durMs),
      duration: durMs,
      season: hasEpisode ? season : undefined,
      episode: hasEpisode ? episode : undefined,
      video_id: hasEpisode ? `${id}:${season}:${episode}` : undefined,
      lastWatched: when,
    },
    removed: false,
    temp: false,
    _ctime: when,
    _mtime: when,
    external: "trakt",
  };
}

function toLibraryItem(raw: RawPlayback): LibraryItem | null {
  const pct = Math.min(100, Math.max(0, raw.progress ?? 0));
  if (pct <= 0 || pct > 99.9) return null;
  const when = raw.paused_at ?? new Date(0).toISOString();

  let item: LibraryItem | null = null;
  if (raw.movie && !raw.episode) {
    const id = movieMetaId(raw.movie.ids);
    item = id ? buildItem(id, "movie", raw.movie, pct, DURATION_MS.movie, when) : null;
  } else if (raw.show) {
    const id = seriesMetaId(raw.show.ids);
    if (id) {
      const season = raw.episode?.season;
      const episode = raw.episode?.number ?? (raw.episode as any)?.episode;
      item = buildItem(id, "series", raw.show, pct, DURATION_MS.series, when, season, episode);
    }
  }
  if (item) {
    if (raw.id != null) item.providerPlaybackIds = { trakt: String(raw.id) };
    const node = raw.movie ?? raw.show;
    const altIds: string[] = [];
    const imdb = node?.ids?.imdb ? String(node.ids.imdb).trim().toLowerCase() : null;
    if (imdb && /^tt\d+$/.test(imdb)) altIds.push(imdb);
    if (node?.ids?.tmdb != null) {
      altIds.push(`${item.type === "movie" ? "tmdb:movie" : "tmdb:tv"}:${node.ids.tmdb}`);
    }
    const unique = altIds.filter((id) => id !== item._id);
    if (unique.length > 0) item.altIds = unique;
  }
  return item;
}

export const TRAKT_PLAYBACK_CACHE_KEY = "harbor.trakt.playback_items";
let memoryTraktPlaybackCache: LibraryItem[] | null = null;

function isValidTraktPlaybackItem(item: LibraryItem): boolean {
  if (!item || item.external !== "trakt" || !item.state) return false;
  if (item.upNext) return false;
  const offset = item.state.timeOffset ?? 0;
  const dur = item.state.duration ?? 0;
  if (offset <= 0 || (item.state.flaggedWatched ?? 0) > 0) return false;
  if (dur > 0 && offset / dur >= 0.9) return false;
  return true;
}

export function readCachedTraktPlaybackItems(): LibraryItem[] {
  if (memoryTraktPlaybackCache && memoryTraktPlaybackCache.length > 0) {
    return memoryTraktPlaybackCache.filter(isValidTraktPlaybackItem);
  }
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(TRAKT_PLAYBACK_CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const valid = parsed.filter(isValidTraktPlaybackItem);
        memoryTraktPlaybackCache = valid;
        if (valid.length !== parsed.length) {
          try {
            localStorage.setItem(TRAKT_PLAYBACK_CACHE_KEY, JSON.stringify(valid));
          } catch {}
        }
        return valid;
      }
    }
  } catch {}
  return [];
}

export function writeCachedTraktPlaybackItems(items: LibraryItem[]): void {
  memoryTraktPlaybackCache = items;
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(TRAKT_PLAYBACK_CACHE_KEY, JSON.stringify(items));
  } catch {}
}

export function clearCachedTraktPlaybackItems(): void {
  memoryTraktPlaybackCache = null;
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(TRAKT_PLAYBACK_CACHE_KEY);
  } catch {}
}

export async function deleteTraktPlayback(
  id: string,
): Promise<{ ok: boolean; retryAfterMs?: number; rateLimited?: boolean }> {
  if (!id) return { ok: true };
  const session = getSession();
  if (!session) return { ok: false };
  const account = session.username;
  // A destructive request may not drift onto another account. Token refreshes
  // of the same account are allowed; an account change cancels the attempt.
  const assertCurrent = () => {
    const current = getSession();
    if (!current) throw new Error("Trakt session ended");
    if (account != null) {
      if (current.username !== account) throw new Error("Trakt account changed");
    } else if (current !== session) {
      throw new Error("Trakt session changed");
    }
  };
  try {
    await traktRequestWithResponse(`/sync/playback/${encodeURIComponent(id)}`, {
      method: "DELETE",
      assertCurrent,
    });
    return { ok: true };
  } catch (error) {
    if (!(error instanceof TraktApiError)) return { ok: false };
    if (error.status === 404) return { ok: true };
    const retryAfterMs =
      error.retryAt != null ? Math.max(0, error.retryAt - Date.now()) : undefined;
    return {
      ok: false,
      ...(retryAfterMs != null ? { retryAfterMs } : {}),
      ...(error.status === 429 ? { rateLimited: true } : {}),
    };
  }
}

const PLAYBACK_PAGE_SIZE = 40;
const PLAYBACK_MAX_PAGES = 5;

export type TraktPlaybackSnapshot = { items: LibraryItem[]; complete: boolean };

/** Live read used by dismissal retries. `complete` is only true when Trakt's own
 * pagination headers prove every page was read; a missing header fails closed. */
export async function fetchTraktPlaybackSnapshot(): Promise<TraktPlaybackSnapshot> {
  if (!getSession()) return { items: [], complete: false };
  const raws: RawPlayback[] = [];
  let page = 1;
  let pageCount = 0;
  while (page <= PLAYBACK_MAX_PAGES) {
    const { data, headers } = await traktRequestWithResponse<RawPlayback[]>(
      `/sync/playback?limit=${PLAYBACK_PAGE_SIZE}&page=${page}`,
    );
    if (!Array.isArray(data)) throw new Error("Trakt playback response was not a list");
    raws.push(...data);
    if (page === 1) {
      const headerCount = Number(headers.get("x-pagination-page-count"));
      if (!Number.isFinite(headerCount) || headerCount < 1) {
        return { items: itemsFromRaw(raws, false, false), complete: false };
      }
      pageCount = headerCount;
    }
    if (page >= pageCount) break;
    page += 1;
  }
  return {
    items: itemsFromRaw(raws, false, false),
    complete: pageCount > 0 && page >= pageCount && pageCount <= PLAYBACK_MAX_PAGES,
  };
}

function itemsFromRaw(raw: RawPlayback[], backfill: boolean, dedupe = true): LibraryItem[] {
  const items: LibraryItem[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    const item = toLibraryItem(r);
    if (!item?.state) continue;
    if (dedupe) {
      const key = `${item._id}|${item.state.season ?? ""}|${item.state.episode ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
    }
    items.push(item);
    if (!backfill) continue;
    // Same dismiss guard as Simkl: no resume backfill for dismissed cards, so a
    // background refresh cannot manufacture fresh activity that beats the dismissal.
    if (isCwDismissed(item)) continue;
    // Newer-wins backfill: overwrite a stale entry when the remote pause is newer
    // (paused_at) or, when the stored entry has no usable timestamp, further ahead.
    const existing = readResumeEntry(item._id, item.state.season, item.state.episode);
    const remoteT = Date.parse(item.state.lastWatched ?? "");
    const remoteValid = Number.isFinite(remoteT) && remoteT > 0;
    const shouldWrite =
      !existing ||
      (remoteValid && remoteT >= existing.t) ||
      (!existing.t && item.state.timeOffset > existing.ms);
    if (shouldWrite) {
      // Persist the true remote percent alongside the synthetic ms so consumers
      // can prefer pct x real runtime once migrated; pct rides along with the
      // winning write and is never mixed with another entry's ms.
      const pct01 = Math.min(100, Math.max(0, r.progress ?? 0)) / 100;
      saveResumeMs(
        item._id,
        item.state.timeOffset,
        item.state.season,
        item.state.episode,
        undefined,
        pct01,
        "trakt",
      );
    }
  }
  return items;
}

export async function fetchTraktPlaybackItems(fresh = false): Promise<LibraryItem[]> {
  if (!getSession()) return [];
  let raw: RawPlayback[];
  try {
    raw = await traktRequest<RawPlayback[]>("/sync/playback?limit=40");
  } catch (e) {
    if (e instanceof TraktApiError && e.status === 404) {
      writeCachedTraktPlaybackItems([]);
      return [];
    }
    if (fresh) throw e;
    const cached = readCachedTraktPlaybackItems();
    if (cached.length > 0) return cached;
    throw e;
  }
  if (!Array.isArray(raw)) return [];

  const items = itemsFromRaw(raw, true);
  writeCachedTraktPlaybackItems(items);
  return items;
}
