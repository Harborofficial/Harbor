export type QuickLibraryMode = "games" | "music";

/** The dock and its Settings row only make sense when at least one of the two libraries is
 * installed. */
export function quickLibraryAvailable(games: boolean, music: boolean): boolean {
  return games || music;
}

/** Games is the default when available, Music when Games is not installed. A requested Music
 * strip falls back to Games when the Music component is absent. The switch itself is only shown
 * when both libraries exist. */
export function quickLibraryMode(
  games: boolean,
  music: boolean,
  requested: QuickLibraryMode,
): QuickLibraryMode {
  if (!games) return "music";
  if (requested === "music" && !music) return "games";
  return requested;
}
