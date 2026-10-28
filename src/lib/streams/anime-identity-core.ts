import type { AniZipMapping } from "@/lib/providers/anizip";

/**
 * Episode coordinates as they appear on a PlayEpisode, regardless of which
 * metadata provider produced the episode list.
 */
export type AnimeEpisodeCoords = {
  season?: number | null;
  episode?: number | null;
  imdbSeason?: number | null;
  imdbEpisode?: number | null;
};

/**
 * Provider coordinate pairs to try when locating an episode inside an AniZip
 * mapping. The IMDb/TVDB-aligned pair (when the episode object carries one)
 * is tried before the raw provider pair.
 */
export function animeCoordPairs(
  episode: AnimeEpisodeCoords | null | undefined,
): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const push = (s: unknown, e: unknown) => {
    if (
      typeof s !== "number" ||
      typeof e !== "number" ||
      !Number.isFinite(s) ||
      !Number.isFinite(e) ||
      s < 1 ||
      e < 1
    ) {
      return;
    }
    if (!out.some(([os, oe]) => os === s && oe === e)) out.push([s, e]);
  };
  push(episode?.imdbSeason, episode?.imdbEpisode);
  push(episode?.season, episode?.episode);
  return out;
}

/**
 * Find the entry-relative episode number for the requested coordinates inside
 * an AniZip mapping. Mapping keys are entry-relative numbers, which is exactly
 * what a `kitsu:{id}:{n}` stream query needs:
 *
 * - Long-running anime (One Piece): one entry spans every provider season, so
 *   TMDB "S23E14" resolves through its seasonNumber/episodeNumber pair to key
 *   1169 — the true absolute episode.
 * - Seasonal anime (SAO II): one entry per cour, so the resolved number is the
 *   season-relative episode.
 *
 * Season guard: if the mapping knows about the requested provider season but
 * has no matching episode, or does not carry that season at all (the entry is
 * a sibling cour of a franchise sharing one IMDb/TMDB id), return null so the
 * caller falls back instead of querying a wrong episode.
 */
export function findAnimeEntryNumber(
  az: AniZipMapping | null | undefined,
  pairs: Array<[number, number]>,
): number | null {
  const entries = Object.entries(az?.episodes ?? {});
  if (entries.length === 0 || pairs.length === 0) return null;
  for (const [season, episodeNumber] of pairs) {
    let coversSeason = false;
    for (const [key, m] of entries) {
      if (m.seasonNumber !== season) continue;
      coversSeason = true;
      if (m.episodeNumber === episodeNumber) {
        const fromKey = Number(key);
        const n =
          Number.isFinite(fromKey) && fromKey > 0 ? fromKey : (m.absoluteEpisodeNumber ?? NaN);
        return Number.isFinite(n) && n > 0 ? n : null;
      }
    }
    // Known season + missing episode: never guess across entries or pairs.
    if (coversSeason) return null;
  }
  // A freshly published cour can ship an AniZip entry whose episodes carry only
  // the entry-relative key and an airdate, no provider season/episode pair yet.
  // For a season-1 request the key is the provider episode number, so match it
  // directly. Later seasons are left to the sibling/sequel resolvers, which can
  // prove ownership instead of guessing across a franchise.
  const flat = entries.every(([, m]) => m.seasonNumber == null && m.episodeNumber == null);
  if (flat) {
    for (const [season, episodeNumber] of pairs) {
      if (season !== 1) continue;
      for (const [key, m] of entries) {
        const fromKey = Number(key);
        const keyed = Number.isFinite(fromKey) && fromKey > 0 ? fromKey : null;
        if (keyed !== episodeNumber && m.absoluteEpisodeNumber !== episodeNumber) continue;
        const n = keyed ?? m.absoluteEpisodeNumber ?? NaN;
        return Number.isFinite(n) && n > 0 ? n : null;
      }
    }
  }
  return null;
}

export interface EpisodeBearing {
  episode: number | null;
  seasonPack: boolean;
  season?: number | null;
  title?: string | null;
  description?: string | null;
  behaviorHints?: { filename?: string; fileName?: string };
}

/**
 * Partition parsed streams around the requested entry-relative episode.
 * Only streams with a concrete mismatched episode token are dropped; packs,
 * batches, and titles without an episode token pass through untouched, since
 * they may legitimately contain the target episode. `valid` may carry both the
 * entry-relative number and a provider alias (split-franchise cours) so streams
 * in either numbering are kept.
 */
export function partitionByExactAnimeEpisode<T extends EpisodeBearing>(
  streams: T[],
  valid: Set<number>,
  coordinates?: Array<[number, number]>,
  splitPart?: number,
  entryTitles?: string[] | null,
): { keep: T[]; drop: T[] } {
  const keep: T[] = [];
  const drop: T[] = [];
  for (const s of streams) {
    const text = `${s.behaviorHints?.filename ?? s.behaviorHints?.fileName ?? ""} ${s.title ?? ""} ${s.description ?? ""}`;
    const partEvidence = splitPart == null || splitPart === 1 || matchesSplitAnimePart(text, splitPart);
    const ambiguousRelative = splitPart != null && splitPart > 1 && s.season == null &&
      s.episode === coordinates?.[0][1] && !partEvidence;
    const wrongEntry = conflictingAnimeEntryTitle(text, entryTitles);
    const wrongSeason = s.season != null && coordinates != null &&
      !coordinates.some(([season]) => season === s.season);
    const wrongPair = s.season != null && s.episode != null && coordinates != null &&
      !coordinates.some(([season, episode]) => season === s.season && episode === s.episode);
    if (wrongEntry || ambiguousRelative || wrongSeason || wrongPair || (!s.seasonPack && s.episode != null && !valid.has(s.episode))) drop.push(s);
    else keep.push(s);
  }
  return { keep, drop };
}

export function animeAbsoluteFromScopedId(id: string | null | undefined): number | null {
  const m = /^(?:kitsu|mal):\d+:(\d+)$/.exec(id ?? "");
  return m ? Number(m[1]) : null;
}

/**
 * Split-franchise handling (foreign-season hiding, solo entry grids) ships
 * scoped to specific shows until proven broader. 244 = Bleach (2004), whose
 * TVDB/TMDB entry folds Thousand-Year Blood War in as later seasons.
 */
export function isScopedSplitFranchiseRoot(rootKitsuId: number | null | undefined): boolean {
  return rootKitsuId === 244;
}

const SPLIT_PART_SEASON: Record<number, number> = {
  43078: 1,
  46903: 2,
  48015: 3,
  49444: 4,
};

export function splitFranchiseDisplaySeason(kitsuId: number | null | undefined): number | null {
  if (kitsuId == null || !Number.isFinite(kitsuId)) return null;
  return SPLIT_PART_SEASON[kitsuId] ?? null;
}

function conflictingAnimeEntryTitle(text: string, expected: string[] | null | undefined): boolean {
  const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ");
  const parts = [
    /\bphantom blood\b/, /\bbattle tendency\b/, /\bstardust crusaders\b/,
    /\b(?:diamond is unbreakable|diamond wa kudakenai)\b/,
    /\b(?:golden wind|ougon no kaze|vento aureo)\b/,
    /\bstone ocean\b/, /\bsteel ball run\b/,
  ];
  const wanted = (expected ?? []).map(normalize);
  const targetParts = parts.filter((part) => wanted.some((title) => part.test(title)));
  if (targetParts.length === 0) return false;
  const actual = normalize(text);
  return parts.some((part) => part.test(actual) && !targetParts.includes(part));
}

function matchesSplitAnimePart(text: string, part: number): boolean {
  const normalized = text.toLowerCase().replace(/[^a-z0-9]+/g, " ");
  const names: Record<number, RegExp> = {
    2: /\b(?:the separation|ketsubetsu tan)\b/,
    3: /\b(?:the conflict|soukoku tan)\b/,
    4: /\b(?:the calamity|kashin tan)\b/,
  };
  return names[part]?.test(normalized) === true ||
    new RegExp(`\\b(?:part|cour|season)\\s*${part}\\b`).test(normalized);
}

/** TYBW's cour, TYBW-continuous and whole-Bleach numbers are distinct spaces. */
export function splitAnimeStreamCoordinates(streamId: string | null | undefined): {
  coordinates: Array<[number, number]>;
  absoluteNumbers: number[];
} | null {
  const match = /^kitsu:(\d+):(\d+)$/.exec(streamId ?? "");
  if (!match) return null;
  const season = splitFranchiseDisplaySeason(Number(match[1]));
  const episode = Number(match[2]);
  if (season == null || episode < 1) return null;
  const offset = [0, 13, 26, 40][season - 1];
  const tybw = offset + episode;
  return { coordinates: [[season, episode], [17, tybw]], absoluteNumbers: [tybw, 366 + tybw] };
}

export function isForeignSplitSeason(
  scopedSplit: boolean,
  nativeSeason: number | null | undefined,
  providerSeason: number | null | undefined,
): boolean {
  if (!scopedSplit) return false;
  if (nativeSeason == null || nativeSeason < 1) return false;
  if (providerSeason == null || providerSeason < 1) return false;
  return providerSeason !== nativeSeason;
}

/**
 * One anime-lists claim: an AniDB entry occupying `season` of a shared
 * provider series, shifted by `offset` episodes within that season.
 * `season: "a"` marks absolute-order entries.
 */
export interface AnimeListWindow {
  anidbId: number;
  season: number | "a";
  offset: number;
}

/**
 * Distinct AniDB entries other than `excludeAnidbId` that claim the requested
 * provider season. Absolute ("a") windows are ignored: they describe whole-show
 * continuous entries, not siblings pinned to a specific season.
 */
export function selectSiblingWindows(
  windows: AnimeListWindow[] | undefined | null,
  season: number,
  excludeAnidbId?: number | null,
): number[] {
  if (!windows || windows.length === 0) return [];
  const out: number[] = [];
  for (const w of windows) {
    if (typeof w.season !== "number" || w.season !== season) continue;
    if (excludeAnidbId != null && w.anidbId === excludeAnidbId) continue;
    if (!out.includes(w.anidbId)) out.push(w.anidbId);
  }
  return out;
}
