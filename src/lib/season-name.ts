const GENERIC_SEASON =
  /^(?:season|sezon|saison|staffel|temporada|stagione|musim|mùa|сезон|الموسم|موسم|सीज़न|シーズン|시즌)\s*(\d+)$/iu;

/** Recognize provider defaults before passing names to a differently localized UI. */
export function isGenericSeasonName(name: string, seasonNumber: number): boolean {
  const text = name.trim();
  const match =
    GENERIC_SEASON.exec(text) ??
    /^第\s*(\d+)\s*季$/u.exec(text) ??
    /^(\d+)\.\s*sezon$/iu.exec(text);
  return !!match && Number(match[1]) === seasonNumber;
}

export function seasonPill(
  item: { name: string; seasonNumber?: number; isGenericName?: boolean },
  translate: (key: string, vars: { n: number }) => string,
): string | null {
  const n = item.seasonNumber;
  if (n == null || n < 1 || item.isGenericName) return null;
  const name = item.name.trim();
  if (name === "All Episodes" || isGenericSeasonName(name, n)) return null;
  const pill = translate("Season {n}", { n });
  return name === pill ? null : pill;
}
