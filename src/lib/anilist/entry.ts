import { anilistRequest } from "./client";
import { loadMedia, metadataCacheTtl } from "@/lib/media-cache";

export type AnilistAnimeEntry = {
  id: number;
  idMal: number | null;
  type: string;
  description?: string | null;
  bannerImage?: string | null;
  seasonYear?: number | null;
  title?: { english?: string | null; romaji?: string | null };
};

const QUERY = `query ($id: Int, $idMal: Int) {
  Media(id: $id, idMal: $idMal, type: ANIME) {
    id idMal type description bannerImage seasonYear title { english romaji }
  }
}`;

export async function anilistAnimeEntry(
  id: number,
  scheme: "anilist" | "mal",
  maxAge?: number,
): Promise<AnilistAnimeEntry | null> {
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const result = await loadMedia<AnilistAnimeEntry>(
    "anilist-anime-entry",
    [scheme, id],
    async () => {
      const data = await anilistRequest<{ Media: AnilistAnimeEntry | null }>(
        QUERY,
        scheme === "mal" ? { idMal: id } : { id },
        undefined,
        true,
      );
      const entry = data.Media;
      if (
        !entry ||
        entry.type !== "ANIME" ||
        !Number.isSafeInteger(entry.id) ||
        entry.id <= 0 ||
        (scheme === "mal" ? entry.idMal !== id : entry.id !== id)
      )
        return null;
      return entry;
    },
    { ttl: metadataCacheTtl, maxAge },
  );
  return result.value;
}
