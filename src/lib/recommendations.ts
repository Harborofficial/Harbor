import type { Meta } from "@/lib/cinemeta";
import { cinemetaDetails } from "@/lib/providers/cinemeta-details";
import { tmdbDetails } from "@/lib/providers/tmdb/tmdb-details";
import { animeRecommendations } from "@/lib/providers/anime-recommendations";
import { parseKitsuId } from "@/lib/providers/kitsu";

const MAX_ITEMS = 18;

/**
 * Recommendations for the end screen. Uses the same sources the detail page
 * does: AniList/Kitsu for Kitsu titles, otherwise TMDB or Cinemeta.
 *
 * An empty list means the caller should fall back to its normal behaviour
 * rather than show a card with nothing in it.
 */
export async function loadMoreLikeThis(meta: Meta, tmdbKey: string | null): Promise<Meta[]> {
  const kitsuId = parseKitsuId(meta.id);
  if (kitsuId != null) {
    return (await animeRecommendations(kitsuId).catch(() => [])).slice(0, MAX_ITEMS);
  }
  const detail = tmdbKey
    ? ((await tmdbDetails(tmdbKey, meta).catch(() => null)) ??
      (await cinemetaDetails(meta).catch(() => null)))
    : await cinemetaDetails(meta).catch(() => null);
  if (!detail) return [];

  const seen = new Set<string>([meta.id]);
  const out: Meta[] = [];
  for (const item of [...detail.recommendations, ...detail.similar]) {
    if (!item?.id || seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
    if (out.length >= MAX_ITEMS) break;
  }
  return out;
}
