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
 * A stable queue for one IMDb ID/API-key scope. Visibility updates only enqueue
 * seasons that have never been attempted, including seasons that returned no
 * ratings. A transient failure can be retried when the user reopens the view.
 */
export function createOmdbSeasonQueue<T>(
  fetchSeason: (season: number) => Promise<T>,
  publish: (season: number, result: T) => void,
): { enqueue: (seasons: readonly number[]) => void; dispose: () => void } {
  const attempted = new Set<number>();
  const pending: number[] = [];
  let active = 0;
  let disposed = false;

  const pump = () => {
    while (!disposed && active < MAX_CONCURRENT_OMDB_SEASONS && pending.length > 0) {
      const season = pending.shift()!;
      active++;
      let request: Promise<T>;
      try {
        request = Promise.resolve(fetchSeason(season));
      } catch {
        active--;
        continue;
      }
      void request
        .then((result) => {
          if (!disposed) publish(season, result);
        })
        .catch(() => {
          // A failed season must not prevent other seasons from loading.
        })
        .finally(() => {
          active--;
          pump();
        });
    }
  };

  return {
    enqueue(seasons) {
      if (disposed) return;
      for (const season of seasons) {
        if (!Number.isInteger(season) || season < 1 || attempted.has(season)) continue;
        attempted.add(season);
        pending.push(season);
      }
      pump();
    },
    dispose() {
      disposed = true;
      pending.length = 0;
    },
  };
}
