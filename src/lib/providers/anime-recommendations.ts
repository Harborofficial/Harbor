import type { Meta } from "@/lib/cinemeta";
import { anilistRecommendations } from "@/lib/anilist/browse";
import { kitsuToAnilist } from "./anime-mapping";
import { kitsuAnime, kitsuRelated, kitsuSimilarByGenres } from "./kitsu";

export async function animeRecommendations(kitsuId: number): Promise<Meta[]> {
  const anime = await kitsuAnime(kitsuId);
  if (!anime) return [];
  const slugs =
    anime.genreSlugs.length > 0
      ? anime.genreSlugs
      : anime.genres
          .map((s) =>
            s
              .toLowerCase()
              .trim()
              .replace(/[^a-z0-9]+/g, "-")
              .replace(/^-+|-+$/g, ""),
          )
          .filter(Boolean);
  const [recommendations, similar, related] = await Promise.all([
    kitsuToAnilist(kitsuId)
      .then((id) => (id ? anilistRecommendations(id) : []))
      .catch(() => [] as Meta[]),
    slugs.length > 0 ? kitsuSimilarByGenres(slugs, kitsuId, 34) : Promise.resolve([] as Meta[]),
    kitsuRelated(kitsuId),
  ]);
  const seen = new Set([`kitsu:${kitsuId}`, ...related.map((r) => r.meta.id)]);
  const names = new Set<string>();
  return [...recommendations, ...similar].filter((m) => {
    const name = m.name.trim().toLowerCase();
    if (seen.has(m.id) || names.has(name)) return false;
    seen.add(m.id);
    names.add(name);
    return true;
  });
}
