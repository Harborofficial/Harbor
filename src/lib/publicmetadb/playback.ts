import { tmdbImdbCached } from "@/lib/providers/tmdb/tmdb-imdb-resolve";
import { pmdbRequest } from "./client";
import { isAuthenticated } from "./session";
import { isCwDismissed } from "@/lib/cw-dismiss";
import { readResumeEntry, saveResumeMs } from "@/lib/resume";
import type { LibraryItem } from "@/lib/stremio";
import { getImdbForTmdb } from "./mappings";
import type { PmdbResumePoint, PmdbResumeResponse } from "./types";

const DURATION_MS = { movie: 6_300_000, series: 2_640_000 };
const RESUME_PER_PAGE = 100;
const RESUME_MAX_PAGES = 10;
// Keep mapping lookups bounded like watched-key enrichment: the PMDB external
// API allows 300 requests per 10 seconds.
const MAP_POOL = 5;
const MAP_MAX = 100;

function tmdbItemId(raw: PmdbResumePoint): string {
  return raw.media_type === "movie" ? `tmdb:movie:${raw.tmdb_id}` : `tmdb:tv:${raw.tmdb_id}`;
}

function mappingKey(raw: PmdbResumePoint): string {
  return `${raw.media_type}:${raw.tmdb_id}`;
}

function toLibraryItem(raw: PmdbResumePoint, imdbId?: string): LibraryItem | null {
  const durMs = raw.runtime_ms > 0
    ? raw.runtime_ms
    : raw.media_type === "movie"
      ? DURATION_MS.movie
      : DURATION_MS.series;

  const posMs = raw.position_ms;
  const ratio = durMs > 0 ? posMs / durMs : (raw.progress > 1 ? raw.progress / 100 : raw.progress);
  if (ratio < 0.02 || ratio > 0.98) return null;

  const isMovie = raw.media_type === "movie";
  const tmdbId = tmdbItemId(raw);
  const id = imdbId ?? tmdbId;
  const hasEpisode = !isMovie && raw.season != null && raw.season > 0 && raw.episode != null && raw.episode > 0;
  const when = raw.updated || raw.created || new Date().toISOString();

  return {
    _id: id,
    type: isMovie ? "movie" : "series",
    name: raw.title ?? (isMovie ? `Movie (${raw.tmdb_id})` : `Series (${raw.tmdb_id})`),
    poster: raw.poster ?? undefined,
    state: {
      timeOffset: Math.round(posMs),
      duration: durMs,
      season: hasEpisode ? raw.season! : undefined,
      episode: hasEpisode ? raw.episode! : undefined,
      video_id: hasEpisode ? `${id}:${raw.season}:${raw.episode}` : undefined,
      lastWatched: when,
    },
    removed: false,
    temp: false,
    _ctime: raw.created || when,
    _mtime: when,
    external: "publicmetadb",
    ...(imdbId ? { altIds: [tmdbId] } : {}),
  };
}

/**
 * PMDB resume points are TMDB ids while Stremio, Trakt, and Simkl prefer IMDb.
 * Resolve the shared identity before the Continue Watching merge so a title
 * cannot appear once for every source. Mapping failures keep the TMDB id.
 */
async function resolvePlaybackImdbIds(
  points: PmdbResumePoint[],
): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  const pending = new Map<string, PmdbResumePoint>();

  for (const raw of points) {
    if (!Number.isFinite(raw.tmdb_id) || raw.tmdb_id <= 0) continue;
    const key = mappingKey(raw);
    if (pending.has(key) || found.has(key)) continue;
    const known = tmdbImdbCached(tmdbItemId(raw));
    if (typeof known === "string" && known) {
      found.set(key, known);
      continue;
    }
    // A cached negative answer is authoritative enough for this refresh.
    if (known === null) continue;
    pending.set(key, raw);
  }

  const queue = [...pending.entries()].slice(0, MAP_MAX);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(MAP_POOL, queue.length) }, async () => {
    while (cursor < queue.length) {
      const next = queue[cursor++];
      if (!next) return;
      const [key, raw] = next;
      try {
        const imdb = await getImdbForTmdb(raw.tmdb_id, raw.media_type);
        if (imdb && /^tt\d+$/.test(imdb)) found.set(key, imdb);
      } catch {
        // Degrade to the TMDB id; the next refresh can retry.
      }
    }
  });
  await Promise.all(workers);
  return found;
}

async function fetchAllResumePoints(): Promise<PmdbResumePoint[]> {
  const out: PmdbResumePoint[] = [];
  try {
    const first = await pmdbRequest<PmdbResumeResponse>(
      `/api/external/resume?page=1&perPage=${RESUME_PER_PAGE}`,
      { method: "GET" },
    );
    if (Array.isArray(first?.items)) out.push(...first.items);
    const totalPages = Math.max(1, Number(first?.totalPages ?? 1) || 1);
    const pages = Math.min(totalPages, RESUME_MAX_PAGES);
    for (let page = 2; page <= pages; page++) {
      try {
        const data = await pmdbRequest<PmdbResumeResponse>(
          `/api/external/resume?page=${page}&perPage=${RESUME_PER_PAGE}`,
          { method: "GET" },
        );
        if (!Array.isArray(data?.items) || data.items.length === 0) break;
        out.push(...data.items);
      } catch {
        break;
      }
    }
  } catch {
    return out;
  }
  return out;
}

export async function fetchPublicMetaDbPlaybackItems(): Promise<LibraryItem[]> {
  if (!isAuthenticated()) return [];

  const all = await fetchAllResumePoints();
  if (all.length === 0) return [];

  const candidates = all.filter((raw) => toLibraryItem(raw) !== null);
  if (candidates.length === 0) return [];

  const imdbByTmdb = await resolvePlaybackImdbIds(candidates);
  const items: LibraryItem[] = [];
  const seen = new Set<string>();

  for (const raw of candidates) {
    const item = toLibraryItem(raw, imdbByTmdb.get(mappingKey(raw)));
    if (!item?.state) continue;

    const key = `${item._id}|${item.state.season ?? ""}|${item.state.episode ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(item);

    if (isCwDismissed(item)) continue;

    const existing = readResumeEntry(item._id, item.state.season, item.state.episode);
    const remoteT = Date.parse(item.state.lastWatched ?? "");
    const remoteValid = Number.isFinite(remoteT) && remoteT > 0;
    const shouldWrite =
      !existing ||
      (remoteValid && remoteT >= existing.t) ||
      (!existing.t && item.state.timeOffset > existing.ms);

    if (shouldWrite) {
      const pct01 = item.state.duration > 0 ? item.state.timeOffset / item.state.duration : 0;
      saveResumeMs(
        item._id,
        item.state.timeOffset,
        item.state.season,
        item.state.episode,
        undefined,
        pct01,
        "publicmetadb",
      );
    }
  }

  return items;
}
