import { getAnimeCwId } from "@/lib/anime-cw-ids";
import {
  animeKitsuMeta,
  type AnimeKitsuMeta,
  type AnimeKitsuVideo,
} from "@/lib/providers/anime-kitsu-addon";
import type { LibraryItem } from "@/lib/stremio";

const ANIME_ID = /^(kitsu|mal|anilist|anidb):/;

export type CwAnimeVideoLookup = (metaId: string) => Promise<AnimeKitsuMeta | null>;

export function matchCwAnimeVideo(
  videos: AnimeKitsuVideo[],
  videoId: string | undefined,
  native: { season: number; episode: number },
): AnimeKitsuVideo | null {
  const exact = videos.find((video) => video.id === videoId);
  if (exact) return exact;
  const provider = videos.find(
    (video) => video.imdbSeason === native.season && video.imdbEpisode === native.episode,
  );
  if (provider) return provider;
  // Provider IDs store provider coordinates, not entry-relative numbering.
  if (/^tt\d+:\d+:\d+$/.test(videoId ?? "") || videoId?.startsWith("tmdb:")) return null;
  return (
    videos.find((video) => video.season === native.season && video.episode === native.episode) ??
    null
  );
}

/**
 * Resolve the Kitsu video behind a Continue Watching row, including catalog
 * rows that only recorded an anime mapping. The lookup is injectable for tests.
 */
export async function resolveCwAnimeVideo(
  item: Pick<LibraryItem, "_id" | "state">,
  native: { season: number; episode: number } | null | undefined,
  lookup: CwAnimeVideoLookup = animeKitsuMeta,
): Promise<AnimeKitsuVideo | null> {
  if (!native || !Number.isInteger(native.episode) || native.episode < 1) return null;
  const metaId = ANIME_ID.test(item._id) ? item._id : getAnimeCwId(item._id);
  if (!metaId) return null;
  const meta = await lookup(metaId).catch(() => null);
  if (!meta) return null;
  return matchCwAnimeVideo(meta.videos, item.state?.video_id, native);
}
