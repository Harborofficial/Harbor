import { fetchAdjacentEpisodes, fetchEpisodeList, nextUnwatchedAfter } from "@/lib/series-episodes";
import { relatedLibraryIds } from "@/lib/providers/anime-mapping";
import type { Meta } from "@/lib/cinemeta";
import {
  episodeFromVideoId,
  isAnimeCwItem,
  isCwMember,
  libraryMetaType,
  type LibraryItem,
} from "@/lib/stremio";
import { isCwDismissed } from "@/lib/cw-dismiss";
import { privateCwProfileId } from "@/lib/cw-profile";
import { isFurther, itemIds, titleKeys } from "@/lib/cw-dedupe";

const ANIME_ID = /^(kitsu|mal|anilist|anidb):/;

export type AnimeMode = "all" | "exclude" | "only";

export function isNextAired(isAnime: boolean, airDate: string | undefined): boolean {
  const t = airDate ? Date.parse(airDate) : NaN;
  if (isAnime) return Number.isFinite(t) && t <= Date.now();
  return !airDate || !Number.isFinite(t) || t <= Date.now();
}

function resurfaceAired(airDate: string | undefined): boolean {
  const t = airDate ? Date.parse(airDate) : NaN;
  return Number.isFinite(t) && t <= Date.now();
}

/**
 * Hide a row copy when the same show has a newer-playback copy in another
 * source (for example, an old IMDb card while the anime room holds the current
 * Kitsu progress). Dedupe only sees cards that made it into the same row.
 */
export async function staleCwIds(
  visible: LibraryItem[],
  pool: LibraryItem[],
): Promise<Set<string>> {
  const stale = new Set<string>();
  if (visible.length === 0 || pool.length === 0) return stale;
  const visibleSet = new Set(visible);
  const byId = new Map<string, LibraryItem[]>();
  const byTitle = new Map<string, LibraryItem[]>();
  for (const item of pool) {
    for (const id of itemIds(item)) {
      const list = byId.get(id);
      if (list) list.push(item);
      else byId.set(id, [item]);
    }
    if (!isAnimeCwItem(item) && !ANIME_ID.test(item._id)) continue;
    for (const key of titleKeys(item)) {
      const list = byTitle.get(key);
      if (list) list.push(item);
      else byTitle.set(key, [item]);
    }
  }
  for (const item of visible) {
    if (!item.state) continue;
    const related = new Set<LibraryItem>();
    for (const id of itemIds(item)) for (const row of byId.get(id) ?? []) related.add(row);
    const anime = isAnimeCwItem(item) || ANIME_ID.test(item._id);
    if (anime) {
      for (const key of titleKeys(item)) for (const row of byTitle.get(key) ?? []) related.add(row);
    }
    if (
      related.size === 0 &&
      (anime || /^tt\d+$/.test(item._id) || item._id.startsWith("tmdb:tv:"))
    ) {
      const ids = await relatedLibraryIds(item._id).catch(() => []);
      for (const id of ids) for (const row of byId.get(id) ?? []) related.add(row);
    }
    related.delete(item);
    if (related.size === 0) continue;
    let best = item;
    for (const row of related) if (isFurther(row, best)) best = row;
    // Only hide a card when the newer copy is actually in this row. A newer
    // copy from a hidden source must not leave the row with no card at all.
    if (best !== item && visibleSet.has(best)) stale.add(item._id);
  }
  return stale;
}

function currentEpisode(i: LibraryItem): { season: number; episode: number } | null {
  const season = i.state?.season;
  const episode = i.state?.episode;
  if (season && episode) return { season, episode };
  const vid = i.state?.video_id ?? "";
  if (ANIME_ID.test(i._id) && vid.split(":").length === 3) {
    const ep = Number(vid.split(":")[2]);
    return Number.isFinite(ep) && ep > 0 ? { season: 1, episode: ep } : null;
  }
  return episodeFromVideoId(vid);
}

const RESURFACE_TTL = 6 * 3600 * 1000;
const RECENT_MS = 45 * 864e5;

export type ResurfaceOptions = {
  tmdbKey: string;
  animeMode: AnimeMode;
  animeCwEnd?: "hide" | "timer";
  hideCaughtUp?: boolean;
};

export type ResurfaceTarget = {
  season: number;
  episode: number;
  waitingForAir?: boolean;
  airDate?: string;
};

type CacheVal = { next: ResurfaceTarget | null; t: number };
const cache = new Map<string, CacheVal>();

export function clearResurfaceCache(): void {
  cache.clear();
}

type WatchedFor = (
  i: LibraryItem,
  cur: { season: number; episode: number },
) => (season: number, episode: number) => boolean;

export async function resurfaceCandidates(
  library: LibraryItem[],
  inCw: Set<string>,
  opts: ResurfaceOptions,
  watchedFor?: WatchedFor,
): Promise<Map<string, ResurfaceTarget>> {
  const now = Date.now();
  const profileScope = privateCwProfileId() ?? "shared";
  const endMode = opts.animeCwEnd ?? "hide";
  const out = new Map<string, ResurfaceTarget>();
  const candidates = library.filter((i) => {
    if (i.type !== "series" && !ANIME_ID.test(i._id)) return false;
    if (!i.state || (i.removed && !i.temp)) return false;
    if (inCw.has(i._id) || isCwMember(i) || isCwDismissed(i)) return false;
    const anime = isAnimeCwItem(i);
    if (opts.animeMode === "exclude" && anime) return false;
    if (opts.animeMode === "only" && !anime) return false;
    const m = (i as Record<string, unknown>)._mtime;
    const mt = typeof m === "number" ? m : Date.parse(String(m ?? ""));
    const rawLw = Date.parse(i.state.lastWatched ?? "");
    const lw = Number.isFinite(rawLw) ? rawLw : Number.isFinite(mt) ? mt : NaN;
    if (!Number.isFinite(lw) || now - lw > RECENT_MS) return false;
    const cur = currentEpisode(i);
    if (cur == null) return false;
    const isWatched =
      (i.state.flaggedWatched ?? 0) > 0 ||
      (i as Record<string, unknown>).manualWatched === true ||
      (i as Record<string, unknown>).external === "nuvio" ||
      (!!watchedFor && watchedFor(i, cur)(cur.season, cur.episode));
    if (!isWatched && !anime) return false;
    if (watchedFor && !watchedFor(i, cur)(cur.season, cur.episode)) return false;
    return true;
  });
  for (const i of candidates) {
    const cur = currentEpisode(i)!;
    const isAnime = isAnimeCwItem(i) || ANIME_ID.test(i._id);
    const key = `${profileScope}|${endMode}|${i._id}:${cur.season}:${cur.episode}`;
    const cached = cache.get(key);
    let nx: ResurfaceTarget | null;
    const meta: Meta = {
      id: i._id,
      type: libraryMetaType(i.type),
      name: i.name,
      poster: i.poster,
      background: i.background,
    };
    if (cached && now - cached.t < RESURFACE_TTL) {
      nx = cached.next;
    } else {
      try {
        const adj = await fetchAdjacentEpisodes(meta, cur, { tmdbKey: opts.tmdbKey });
        if (adj.next) {
          const aired = resurfaceAired(adj.next.airDate);
          if (aired) {
            nx = {
              season: adj.next.season,
              episode: adj.next.episode,
              waitingForAir: false,
              airDate: adj.next.airDate,
            };
          } else if (!isAnime && !adj.next.airDate && adj.next.season > cur.season) {
            // A future season's placeholder episode is not a countdown target.
            nx = null;
          } else if (endMode === "timer") {
            nx = {
              season: adj.next.season,
              episode: adj.next.episode,
              waitingForAir: true,
              airDate: adj.next.airDate,
            };
          } else {
            nx = null;
          }
        } else if (
          endMode === "timer" &&
          !opts.hideCaughtUp &&
          i.external !== "simkl" &&
          i.external !== "trakt"
        ) {
          nx = { season: cur.season, episode: cur.episode, waitingForAir: true };
        } else {
          nx = null;
        }
        const airTime = adj.next?.airDate ? Date.parse(adj.next.airDate) : NaN;
        const cacheTtl =
          Number.isFinite(airTime) && airTime > now
            ? Math.max(1000, Math.min(RESURFACE_TTL, airTime - now + 1000))
            : RESURFACE_TTL;
        cache.set(key, { next: nx, t: now - (RESURFACE_TTL - cacheTtl) });
      } catch {
        // A failed lookup must remain retryable on the next refresh.
        continue;
      }
    }
    if (nx && !nx.waitingForAir && watchedFor && watchedFor(i, cur)(nx.season, nx.episode)) {
      nx = await fetchEpisodeList(meta, { tmdbKey: opts.tmdbKey })
        .then((list) => {
          const target = nextUnwatchedAfter(list, cur, watchedFor(i, cur));
          if (!target) {
            return i.external !== "simkl" &&
              i.external !== "trakt" &&
              endMode === "timer" &&
              !opts.hideCaughtUp
              ? { season: cur.season, episode: cur.episode, waitingForAir: true }
              : null;
          }
          const entry = list.find(
            (e) => e.season === target.season && e.episode === target.episode,
          );
          if (!isAnime && target.season > cur.season && !entry?.airDate) return null;
          if (entry && resurfaceAired(entry.airDate)) {
            return {
              season: target.season,
              episode: target.episode,
              waitingForAir: false,
              airDate: entry.airDate,
            };
          }
          if (endMode === "timer") {
            return {
              season: target.season,
              episode: target.episode,
              waitingForAir: true,
              airDate: entry?.airDate,
            };
          }
          return null;
        })
        .catch(() => null);
      // Cache episode availability only. Watched history can change independently
      // of this cache, including after switching connected accounts.
    }
    if (nx) {
      const related = await relatedLibraryIds(i._id).catch(() => []);
      if (related.some((r) => inCw.has(r))) continue;
      out.set(i._id, nx);
    }
  }
  return out;
}
