import { traktRequest, TraktApiError } from "./client";
import { getSession } from "./session";
import { isCwDismissed } from "@/lib/cw-dismiss";
import { readResumeEntry, saveResumeMs } from "@/lib/resume";
import type { LibraryItem } from "@/lib/stremio";
import type { TraktIds } from "./types";

type Node = { title?: string; year?: number | null; ids?: TraktIds };

type RawPlayback = {
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

  if (raw.movie && !raw.episode) {
    const id = movieMetaId(raw.movie.ids);
    return id ? buildItem(id, "movie", raw.movie, pct, DURATION_MS.movie, when) : null;
  }

  if (raw.show) {
    const id = seriesMetaId(raw.show.ids);
    if (!id) return null;
    const season = raw.episode?.season;
    const episode = raw.episode?.number ?? (raw.episode as any)?.episode;
    return buildItem(id, "series", raw.show, pct, DURATION_MS.series, when, season, episode);
  }
  return null;
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

export async function fetchTraktPlaybackItems(): Promise<LibraryItem[]> {
  if (!getSession()) return [];
  let raw: RawPlayback[];
  try {
    raw = await traktRequest<RawPlayback[]>("/sync/playback?limit=40");
  } catch (e) {
    if (e instanceof TraktApiError && e.status === 404) {
      writeCachedTraktPlaybackItems([]);
      return [];
    }
    const cached = readCachedTraktPlaybackItems();
    if (cached.length > 0) return cached;
    throw e;
  }
  if (!Array.isArray(raw)) return [];

  const items: LibraryItem[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    const item = toLibraryItem(r);
    if (!item?.state) continue;
    const key = `${item._id}|${item.state.season ?? ""}|${item.state.episode ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(item);
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
  writeCachedTraktPlaybackItems(items);
  return items;
}
