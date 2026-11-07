import type { Meta } from "@/lib/cinemeta";
import type { PlayEpisode, PlayerSrc } from "@/lib/view";
import { completedDownloadFor, type DownloadItem } from "./downloads-store";
import { downloadPlayerSrc } from "./player-src";

type DownloadLookup = (metaId: string, season: number | null, episode: number | null) => Promise<DownloadItem | null>;

/** Use a completed, existing on-disk download before looking for a stream. */
export async function completedEpisodeSource(
  meta: Meta,
  episode: PlayEpisode,
  opts?: { imdbId?: string | null; isAnime?: boolean; startFromZero?: boolean },
  lookup: DownloadLookup = completedDownloadFor,
): Promise<PlayerSrc | null> {
  const item = await lookup(meta.id, episode.season, episode.episode);
  if (!item || item.status !== "done" || item.metaId !== meta.id ||
      item.season !== episode.season || item.episode !== episode.episode) return null;
  return {
    ...downloadPlayerSrc(meta, episode, item, opts),
    ...(opts?.startFromZero ? { startFromZero: true } : {}),
  };
}
