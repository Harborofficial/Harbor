import { lruSet } from "@/lib/cache";
import { onMediaCacheClear, mediaCacheGeneration, MEDIA_TTL } from "@/lib/media-cache";
import { registerCache } from "@/lib/memory-profiler";
import { isGenericEpisodeName } from "../anime-episode-build";
import { tmdbSeasonEpisodes } from "./tmdb-details";
import { tmdbIdFromImdb } from "./tmdb-imdb-resolve";
import { effectiveTmdbLanguage } from "./tmdb-client";
import { tmdbStillUrl } from "./tmdb-image-rungs";
import type { TmdbEpisodeText } from "./tmdb-episode-name-merge";

const NAMES_MAX = 120;
const namesCache = new Map<string, { value: Map<number, TmdbEpisodeText>; expires: number }>();
const inflight = new Map<string, Promise<Map<number, TmdbEpisodeText>>>();
onMediaCacheClear(() => {
  namesCache.clear();
  inflight.clear();
});
const NO_NAMES: Map<number, TmdbEpisodeText> = new Map();

registerCache("tmdb:episodeNames", () => namesCache.size);

async function seriesTvId(key: string, metaId: string): Promise<number | null> {
  const direct = /^tmdb:tv:(\d+)$/.exec(metaId);
  if (direct) return Number(direct[1]);
  if (!metaId.startsWith("tt")) return null;
  const resolved = await tmdbIdFromImdb(key, metaId, "series");
  const mapped = resolved ? /^tmdb:tv:(\d+)$/.exec(resolved) : null;
  return mapped ? Number(mapped[1]) : null;
}

export async function tmdbEpisodeNames(
  key: string,
  metaId: string,
  season: number,
): Promise<Map<number, TmdbEpisodeText>> {
  if (!key || !metaId || season < 1) return NO_NAMES;
  const cacheKey = `${key}:${metaId}:${season}:${effectiveTmdbLanguage() || "en"}`;
  const hit = namesCache.get(cacheKey);
  if (hit && hit.expires > Date.now()) return hit.value;
  const running = inflight.get(cacheKey);
  if (running) return running;
  const generation = mediaCacheGeneration();
  const run = (async () => {
    const tvId = await seriesTvId(key, metaId).catch(() => null);
    const raw = tvId == null ? [] : await tmdbSeasonEpisodes(key, tvId, season).catch(() => []);
    const out = new Map<number, TmdbEpisodeText>();
    for (const e of raw) {
      const name = e.name?.trim() ?? "";
      if (!name || isGenericEpisodeName(name)) continue;
      out.set(e.episodeNumber, {
        name,
        overview: e.overview?.trim() ?? "",
        still: tmdbStillUrl(e.stillPath),
      });
    }
    if (generation === mediaCacheGeneration() && (tvId == null || raw.length > 0))
      lruSet(
        namesCache,
        cacheKey,
        { value: out, expires: Date.now() + MEDIA_TTL.recent },
        NAMES_MAX,
      );
    return out;
  })().finally(() => {
    if (inflight.get(cacheKey) === run) inflight.delete(cacheKey);
  });
  inflight.set(cacheKey, run);
  return run;
}
