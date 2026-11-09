import type { PlayEpisode } from "@/lib/view";

export type SeasonIndex = {
  maxEpisode: ReadonlyMap<number, number>;
  maxOrderKey: number;
};

const cache = new WeakMap<readonly PlayEpisode[], SeasonIndex>();

/**
 * Per-list season maxima. Episode arrays are cached and treated as immutable
 * (Cinemeta/addon caches and the CW hook's per-card list), so identity is a
 * safe cache key. Never pass filtered or sorted copies.
 */
export function seasonIndex(list: readonly PlayEpisode[]): SeasonIndex {
  const cached = cache.get(list);
  if (cached) return cached;

  const maxEpisode = new Map<number, number>();
  let maxOrderKey = 0;
  for (const entry of list) {
    const previous = maxEpisode.get(entry.season);
    if (previous === undefined || entry.episode > previous) {
      maxEpisode.set(entry.season, entry.episode);
    }
    const key = entry.season * 100_000 + entry.episode;
    if (key > maxOrderKey) maxOrderKey = key;
  }

  const built = { maxEpisode, maxOrderKey };
  cache.set(list, built);
  return built;
}
