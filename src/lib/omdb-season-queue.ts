/** Only a few OMDb season requests should be in flight for one episode view. */
export const MAX_CONCURRENT_OMDB_SEASONS = 2;
export const MAX_EAGER_OMDB_SEASONS = 4;

/** Keep large alternate orders lazy, but never leave the first screen without ratings. */
export function selectOmdbSeasonsForOrder(
  canonicalSeasons: readonly number[],
  visibleSeasons: readonly number[],
  preferredSeason?: number,
): { lazy: boolean; seasons: number[] } {
  const seasons = [...new Set(canonicalSeasons)].filter(
    (season) => Number.isInteger(season) && season >= 1,
  );
  if (seasons.length <= MAX_EAGER_OMDB_SEASONS) return { lazy: false, seasons };
  const available = new Set(seasons);
  const initial =
    preferredSeason != null && available.has(preferredSeason) ? preferredSeason : seasons[0];
  return {
    lazy: true,
    seasons: [...new Set([initial, ...visibleSeasons.filter((season) => available.has(season))])],
  };
}

/**
 * Work through requested canonical seasons without firing every request at once.
 * If the view changes or unmounts, do not start more requests for the old view.
 */
export async function loadOmdbSeasonsBounded<T>(
  seasons: readonly number[],
  fetchSeason: (season: number) => Promise<T>,
  publish: (season: number, result: T) => void,
  isCancelled: () => boolean,
): Promise<void> {
  const queue = [...new Set(seasons)].filter((season) => Number.isInteger(season) && season >= 1);
  let next = 0;
  const worker = async () => {
    while (!isCancelled() && next < queue.length) {
      const season = queue[next++];
      try {
        const result = await fetchSeason(season);
        if (isCancelled()) return;
        publish(season, result);
      } catch {
        // One failed season must not block the remaining ratings.
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(MAX_CONCURRENT_OMDB_SEASONS, queue.length) }, worker),
  );
}
