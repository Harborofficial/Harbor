import type { Meta } from "@/lib/cinemeta";
import type { AnilistMedia, AnilistMediaEntry } from "./types";
import { recordAnilistMalAlias } from "@/lib/anime-cw-ids";

function stripHtml(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function anilistMediaToMeta(m: AnilistMedia): Meta | null {
  // AniList already returned both IDs. Cache their equivalence locally so
  // Continue Watching never has to request an extra AniZip mapping.
  recordAnilistMalAlias(m.id, m.idMal);
  const name = m.title.english || m.title.userPreferred || m.title.romaji;
  if (!name) return null;
  const id = m.idMal != null ? `mal:${m.idMal}` : `anilist:${m.id}`;
  return {
    id,
    type: m.format === "MOVIE" ? "movie" : "series",
    name,
    poster: m.coverImage.large ?? m.coverImage.extraLarge ?? undefined,
    background: m.bannerImage ?? undefined,
    description: m.description ? stripHtml(m.description) : undefined,
    releaseInfo: m.seasonYear != null ? String(m.seasonYear) : undefined,
    imdbRating: m.averageScore != null ? (m.averageScore / 10).toFixed(1) : undefined,
    country: m.countryOfOrigin ?? undefined,
    animeFormat: m.format ?? undefined,
  };
}

export function anilistEntryToMeta(entry: AnilistMediaEntry): Meta | null {
  return anilistMediaToMeta(entry.media);
}
