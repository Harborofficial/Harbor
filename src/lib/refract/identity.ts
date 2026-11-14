/** Never send title-only matches; Refract resolves externally verified IDs. */
export function parseRefractHistoryId(raw: string, kind: "movie" | "episode") {
  if (/^tt\d+$/i.test(raw)) return { type: "imdb" as const, id: raw };
  let m = /^imdb:(tt\d+)$/i.exec(raw);
  if (m) return { type: "imdb" as const, id: m[1] };
  m = /^tmdb:(movie|tv):(\d+)$/i.exec(raw);
  if (m && m[1] === (kind === "movie" ? "movie" : "tv")) return { type: "tmdb" as const, id: m[2] };
  m = /^tvdb:(\d+)$/i.exec(raw);
  if (m && kind === "episode") return { type: "tvdb" as const, id: m[1] };
  return null;
}

// Native anime numbering is not interchangeable with IMDb season/episode numbering.
export function refractMappedEpisodes(
  episodes: Array<{ imdbSeason?: number; imdbEpisode?: number }>,
): Array<{ season: number; episode: number }> | undefined {
  const mapped = episodes.map(({ imdbSeason, imdbEpisode }) => ({
    season: imdbSeason,
    episode: imdbEpisode,
  }));
  if (
    !mapped.length ||
    mapped.some(
      ({ season, episode }) =>
        season == null ||
        !Number.isInteger(season) ||
        season < 0 ||
        episode == null ||
        !Number.isInteger(episode) ||
        episode < 1,
    )
  )
    return undefined;
  return mapped.map(({ season, episode }) => ({ season: season!, episode: episode! }));
}

// A late verification must never save credentials after navigation or a new attempt.
export function createRefractAttemptGuard() {
  let generation = 0;
  return {
    begin() {
      const attempt = ++generation;
      return () => attempt === generation;
    },
    invalidate() {
      generation++;
    },
  };
}
