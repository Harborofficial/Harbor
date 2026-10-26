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
    if ((i.state.flaggedWatched ?? 0) > 0)
      return !watchedFor || watchedFor(i, cur)(cur.season, cur.episode);
    return anime && !!watchedFor && watchedFor(i, cur)(cur.season, cur.episode);
  });
  for (const i of candidates) {
    const cur = currentEpisode(i)!;
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
          } else if (endMode === "timer" && !opts.hideCaughtUp) {
            nx = {
              season: adj.next.season,
              episode: adj.next.episode,
              waitingForAir: true,
              airDate: adj.next.airDate,
            };
          } else {
            nx = null;
          }
        } else if (endMode === "timer" && !opts.hideCaughtUp) {
          nx = { season: cur.season, episode: cur.episode, waitingForAir: true };
        } else {
          nx = null;
        }
        cache.set(key, { next: nx, t: now });
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
            return endMode === "timer" && !opts.hideCaughtUp
              ? { season: cur.season, episode: cur.episode, waitingForAir: true }
              : null;
          }
          const entry = list.find((e) => e.season === target.season && e.episode === target.episode);
          if (entry && resurfaceAired(entry.airDate)) {
            return {
              season: target.season,
              episode: target.episode,
              waitingForAir: false,
              airDate: entry.airDate,
            };
          }
          if (endMode === "timer" && !opts.hideCaughtUp) {
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
