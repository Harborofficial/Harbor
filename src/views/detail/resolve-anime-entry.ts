import type { Meta } from "@/lib/cinemeta";
import { aniZipByKitsu, aniZipByTmdbTv, aniZipByImdb } from "@/lib/providers/anizip";
import { kitsuAnime, kitsuRelated, parseKitsuId } from "@/lib/providers/kitsu";
import type { TmdbDetail } from "@/lib/providers/tmdb";

const SIDE_ENTRY_TYPES = new Set(["ova", "ona", "special", "music"]);
const CANDIDATE_ROLES = new Set(["other", "parent_story", "full_story"]);
const MAX_CANDIDATES = 12;

function year(value: string | undefined): number {
  const parsed = Number(value?.slice(0, 4));
  return Number.isFinite(parsed) && parsed > 1900 ? parsed : 0;
}

function normalizeTitle(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

export async function recoverDetailAnimeEntry(
  meta: Meta,
  detail: Pick<TmdbDetail, "title" | "year" | "imdbId"> | null,
): Promise<number | null> {
  const tmdb = /^tmdb:tv:([1-9]\d*)$/.exec(meta.id);
  const imdb = /^tt\d+$/.test(meta.id) ? meta.id : null;
  if (!tmdb && !imdb) return null;
  const requestedYear = year(meta.releaseInfo) || year(detail?.year);
  const title = normalizeTitle(meta.name || detail?.title || "");
  if (!requestedYear || !title) return null;
  const az = tmdb
    ? await aniZipByTmdbTv(Number(tmdb[1])).catch(() => null)
    : await aniZipByImdb(imdb!).catch(() => null);
  const mappings = az?.mappings;
  if (
    !mappings ||
    (tmdb && String(mappings.themoviedb_id) !== tmdb[1]) ||
    (imdb && mappings.imdb_id !== imdb)
  )
    return null;
  const id =
    mappings.anilist_id != null
      ? `anilist:${mappings.anilist_id}`
      : mappings.mal_id != null
        ? `mal:${mappings.mal_id}`
        : null;
  if (!id) return null;
  const { resolveAnimeEntry } = await import("@/lib/providers/anime-entry");
  const entry = await resolveAnimeEntry(id).catch(() => null);
  if (!entry || (mappings.kitsu_id != null && mappings.kitsu_id !== entry.kitsuId)) return null;
  const candidate = await kitsuAnime(entry.kitsuId).catch(() => null);
  if (
    !candidate ||
    year(candidate.year) !== requestedYear ||
    ![candidate.title, ...candidate.altTitles].some((name) => normalizeTitle(name) === title)
  )
    return null;
  const subtype = candidate.subtype?.toLowerCase();
  if (subtype !== "tv" && subtype !== "ona") return null;
  return entry.kitsuId;
}

export async function resolveDetailAnimeEntry(
  kitsuId: number,
  meta: Meta,
  detail: Pick<TmdbDetail, "title" | "year" | "imdbId"> | null,
): Promise<number | null> {
  const tmdb = /^tmdb:tv:(\d+)$/.exec(meta.id);
  const imdb = /^tt\d+$/.test(meta.id) ? meta.id : detail?.imdbId;
  if (
    (meta.type !== "series" && meta.type !== "tv") ||
    (!tmdb && !/^tt\d+$/.test(meta.id)) ||
    (meta.animeFormat && meta.animeFormat.toLowerCase() !== "tv")
  )
    return kitsuId;

  const requestedYear = year(meta.releaseInfo) || year(detail?.year);
  const title = normalizeTitle(meta.name || detail?.title || "");
  if (!requestedYear || !title) return kitsuId;

  const mapped = await kitsuAnime(kitsuId).catch(() => null);
  if (
    !mapped ||
    !SIDE_ENTRY_TYPES.has((mapped.subtype ?? "").toLowerCase()) ||
    mapped.episodeCount !== 1 ||
    !year(mapped.year) ||
    year(mapped.year) === requestedYear
  )
    return kitsuId;

  // A special can share the TV series' external IDs. An "other" relation is
  // only a candidate: require the requested title/year and its own ID mapping.
  const related = await kitsuRelated(kitsuId).catch(() => []);
  const candidateIds = [
    ...new Set(
      related
        .filter((entry) => CANDIDATE_ROLES.has(entry.role.toLowerCase()))
        .map((entry) => parseKitsuId(entry.meta.id))
        .filter((id): id is number => id != null && id !== kitsuId),
    ),
  ];
  if (candidateIds.length > MAX_CANDIDATES) return null;

  const matches = await Promise.all(
    candidateIds.map(async (id) => {
      const candidate = await kitsuAnime(id).catch(() => null);
      if (
        candidate?.subtype?.toLowerCase() !== "tv" ||
        year(candidate.year) !== requestedYear ||
        ![candidate.title, ...candidate.altTitles].some((name) => normalizeTitle(name) === title)
      )
        return null;

      const mappings = (await aniZipByKitsu(id).catch(() => null))?.mappings;
      if (!mappings || mappings.kitsu_id !== id) return null;
      if (tmdb && String(mappings.themoviedb_id) !== tmdb[1]) return null;
      if (imdb && mappings.imdb_id !== imdb) return null;
      return id;
    }),
  );
  const verified = matches.filter((id): id is number => id != null);
  return verified.length === 1 ? verified[0] : null;
}
