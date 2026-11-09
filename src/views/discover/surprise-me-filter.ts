import type { Meta } from "@/lib/cinemeta";
import { isTitleWatched } from "@/lib/watched-title";

export type SurpriseWatchedSources = {
  watchedFlags: Set<string>;
  movieWatched: Set<string>;
  externalWatched: Set<string>;
  stremioWatched: Set<string>;
};

export function filterSurprisePool(
  pool: Meta[],
  excludeWatched: boolean,
  sources: SurpriseWatchedSources,
): Meta[] {
  if (!excludeWatched) return pool;
  const remote = new Set([...sources.externalWatched, ...sources.stremioWatched]);
  return pool.filter(
    (meta) =>
      meta.type !== "movie" ||
      !isTitleWatched(meta, {
        watchedFlags: sources.watchedFlags,
        movieWatched: sources.movieWatched,
        stremioWatched: remote,
      }),
  );
}
