/**
 * Derive the displayed coordinates for an advanced Continue Watching episode.
 * An old season-zero (specials) state must never override a verified regular
 * provider episode, particularly when a new anime cour has just started.
 */
export function cwNextDisplayCoords(
  original: { season: number; episode: number },
  effective: { season: number; episode: number },
  next: {
    season: number;
    episode: number;
    imdbSeason?: number | null;
    imdbEpisode?: number | null;
  },
  remappedMixed: boolean,
  storedAsSpecial = false,
): { season: number; episode: number } {
  const providerRegular =
    Number.isInteger(next.imdbSeason) &&
    (next.imdbSeason ?? 0) >= 1 &&
    Number.isInteger(next.imdbEpisode) &&
    (next.imdbEpisode ?? 0) >= 1;
  if (providerRegular && (storedAsSpecial || original.season === 0 || next.season === 0)) {
    return { season: next.imdbSeason!, episode: next.imdbEpisode! };
  }
  return {
    season: remappedMixed
      ? next.season
      : original.season !== effective.season
        ? original.season
        : next.season,
    episode: next.episode,
  };
}
