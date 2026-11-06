import {
  aniZipByAnidb,
  aniZipByAnilist,
  aniZipByKitsu,
  aniZipByMal,
  type AniZipMapping,
} from "@/lib/providers/anizip";
import { getAnimeCanonicalId, getAnimeCwId } from "@/lib/anime-cw-ids";
import { cwAnimeIdentityKey, getCachedCatalogImdb } from "@/lib/cw-anime-identity";
import { externalToKitsu } from "@/lib/providers/anime-mapping";
import { parseKitsuId } from "@/lib/providers/kitsu";

export type AnimeTitleLang = "english" | "romaji" | "native";

export function getTitleFromAniZip(
  titles: Record<string, string>,
  lang: AnimeTitleLang,
): string | null {
  if (lang === "english") return titles.en || titles.ja || null;
  // AniZip's `x-jat` is AniDB's *abbreviated short title* ("OP TV", "Bleach3",
  // "SnK"), never a romaji series title, so romaji resolves from Kitsu below.
  if (lang === "romaji") return titles.en || null;
  if (lang === "native") return titles.ja || titles.en || null;
  return null;
}

export function getTitleFromKitsu(
  titles: { en?: string; en_jp?: string; ja_jp?: string },
  lang: AnimeTitleLang,
): string | null {
  if (lang === "english") return titles.en || titles.en_jp || titles.ja_jp || null;
  if (lang === "romaji") return titles.en_jp || titles.en || titles.ja_jp || null;
  if (lang === "native") return titles.ja_jp || titles.en_jp || titles.en || null;
  return null;
}

const KITSU_TITLES_TTL = 30 * 60 * 1000;
const KITSU_TITLES_MISS_TTL = 5 * 60 * 1000;
const KITSU_TITLES_MAX = 300;
const kitsuTitlesCache = new Map<number, { v: Record<string, string> | null; t: number }>();

/** Kitsu's own title map, the only source carrying a real romaji (`en_jp`). */
async function kitsuTitles(kitsuId: number): Promise<Record<string, string> | null> {
  const hit = kitsuTitlesCache.get(kitsuId);
  if (hit && Date.now() - hit.t < (hit.v ? KITSU_TITLES_TTL : KITSU_TITLES_MISS_TTL)) return hit.v;
  try {
    const res = await fetch(`https://kitsu.io/api/edge/anime/${kitsuId}`, {
      headers: { Accept: "application/vnd.api+json" },
    });
    const titles = res.ok
      ? (((await res.json())?.data?.attributes?.titles as Record<string, string> | null) ?? null)
      : null;
    if (kitsuTitlesCache.size >= KITSU_TITLES_MAX) kitsuTitlesCache.clear();
    kitsuTitlesCache.set(kitsuId, { v: titles, t: Date.now() });
    return titles;
  } catch {
    return null;
  }
}

/** The Kitsu entry behind any id a card can carry, including Cinemeta rows. */
async function kitsuIdFor(id: string, entryId?: string | null): Promise<number | null> {
  if (entryId?.startsWith("kitsu:")) return parseKitsuId(entryId);
  const lookupId = entryId ?? id;
  if (lookupId.startsWith("kitsu:")) return parseKitsuId(lookupId);
  // A previously visited native entry already has its canonical Kitsu ID.
  if (!entryId) {
    const known = parseKitsuId(getAnimeCanonicalId(id) ?? "");
    if (known != null) return known;
  }
  const external: Array<[string, string]> = [
    ["mal:", "myanimelist"],
    ["anilist:", "anilist"],
    ["anidb:", "anidb"],
  ];
  for (const [prefix, source] of external) {
    if (!lookupId.startsWith(prefix)) continue;
    const n = Number(lookupId.slice(prefix.length));
    return Number.isFinite(n) ? externalToKitsu(source, n).catch(() => null) : null;
  }
  if (/^tt\d+$/.test(lookupId)) {
    // IMDb is a shared series identifier: reverse lookup may return a special.
    // Without a recorded entry, use the card's existing title instead.
    return parseKitsuId(entryId ?? cwAnimeIdentityKey(lookupId) ?? "");
  }
  return null;
}

async function aniZipFor(id: string, entryId?: string | null): Promise<AniZipMapping | null> {
  if (entryId?.startsWith("kitsu:")) {
    const n = parseKitsuId(entryId);
    return n != null ? aniZipByKitsu(n) : null;
  }
  const lookupId = entryId ?? id;
  if (lookupId.startsWith("kitsu:")) {
    const n = parseKitsuId(lookupId);
    return n != null ? aniZipByKitsu(n) : null;
  }
  if (lookupId.startsWith("mal:")) {
    const n = Number(lookupId.slice(4));
    return Number.isFinite(n) ? aniZipByMal(n) : null;
  }
  if (lookupId.startsWith("anilist:")) {
    const n = Number(lookupId.slice(8));
    return Number.isFinite(n) ? aniZipByAnilist(n) : null;
  }
  if (lookupId.startsWith("anidb:")) {
    const n = Number(lookupId.slice(6));
    return Number.isFinite(n) ? aniZipByAnidb(n) : null;
  }
  if (/^tt\d+$/.test(lookupId)) {
    const entry = entryId ?? cwAnimeIdentityKey(lookupId);
    const kitsuId = entry ? parseKitsuId(entry) : null;
    return kitsuId != null ? aniZipByKitsu(kitsuId) : null;
  }
  return null;
}

export async function resolvePreferredAnimeTitle(
  id: string,
  lang: AnimeTitleLang,
  checkpoint?: {
    videoId?: string | null;
    season?: number;
    episode?: number;
    imdbId?: string | null;
  },
): Promise<string | null> {
  // Resolve the catalog entry once. This keeps AniZip and Kitsu title variants
  // aligned to the episode represented by a Continue Watching card. Only pass
  // coordinates when they are complete: otherwise cwAnimeIdentityKey can parse
  // them from the saved video id.
  const coordinates =
    Number.isInteger(checkpoint?.season) && Number.isInteger(checkpoint?.episode)
      ? {
          season: checkpoint?.season,
          episode: checkpoint?.episode,
          imdbId: checkpoint?.imdbId ?? getCachedCatalogImdb(id),
        }
      : undefined;
  const resolvedEntryId = checkpoint
    ? cwAnimeIdentityKey(id, checkpoint.videoId, coordinates)
    : null;
  // Native provider IDs identify their own entry even before background identity
  // warming has established a shared Kitsu identity. Catalog IDs fall back to an
  // already-recorded mapping; this is not the ambiguous IMDb reverse lookup the
  // checkpoint proof replaced.
  const entryId =
    resolvedEntryId ??
    (checkpoint && /^(kitsu|mal|anilist|anidb):[1-9]\d*$/.test(id) ? id : null) ??
    (checkpoint ? getAnimeCwId(id) : null);
  const kitsuId = await kitsuIdFor(id, entryId).catch(() => null);
  if (lang === "romaji" && kitsuId != null) {
    const titles = await kitsuTitles(kitsuId);
    const title = titles ? getTitleFromKitsu(titles, "romaji") : null;
    if (title) return title;
  }
  const mapping = await aniZipFor(id, entryId).catch(() => null);
  if (mapping?.titles) {
    const title = getTitleFromAniZip(mapping.titles, lang);
    if (title) return title;
  }
  if (kitsuId != null) {
    const titles = await kitsuTitles(kitsuId);
    if (titles) return getTitleFromKitsu(titles, lang);
  }
  return null;
}
