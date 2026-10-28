// Strip compatibility marks before NFKD: ™ and ℠ decompose to "TM"/"SM", which
// would otherwise leave "simstm" in the key and break exact title matching.
export const sourceTitleKey = (title: string) => title.replace(/[™℠]/g, "").normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase().replace(/[®©]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Website search engines index the words, not the trademark glyphs in a catalog title. */
export const sourceSearchTitle = (title: string) => title.replace(/[™℠®©]/g, "").replace(/\s+/g, " ").trim();

/** A trailing edition label still names the same game; sequels, remasters and add-ons do not. */
export const SOURCE_EDITION_LABELS = ["digital deluxe edition", "deluxe edition", "ultimate edition", "gold edition", "premium edition", "complete edition", "definitive edition"] as const;
export function sourceEditionKey(key: string): string | undefined {
  for (const label of SOURCE_EDITION_LABELS) {
    if (key.endsWith(` ${label}`)) return key.slice(0, -(label.length + 1)).trim() || undefined;
  }
  return undefined;
}

/** Remove distribution metadata, never named editions, sequels, remasters or subtitles. */
export function sourceDownloadTitle(title: string): string {
  // Tracker packaging is a suffix, not part of the catalog title. Keep unknown
  // brackets and numbered chapters: those can identify a different game.
  const unpacked = title
    .split(/\s+\[(?:[PLR]\]\s+(?=\[|\((?:19|20)\d{2})|(?:RUS|ENG|MULTI\d*|x86|amd64|x64|ARM64)(?=[\s,+/|\]])[^\]]*\])/i)[0]
    .replace(/\s+\((?:19|20)\d{2}\)(?=\s+(?:PC\b|\(v[.\s]?\d|\[)).*$/i, "");
  return unpacked.split(/\s+(?:(?:[–—|]|-\s)\s*)?(?:[[(]\s*)?(?:v[.\s]*\d+(?:[.\s(]|$)|ver(?:sion)?[.\s]+\d|build[\s-]*\d|free\s+download\b|(?:fitgirl\s+|dodi\s+)?repack\b|\+\s*\d+\s+dlcs?\b)/i)[0].replace(/[\s,/:|–—-]+$/, '').trim();
}
