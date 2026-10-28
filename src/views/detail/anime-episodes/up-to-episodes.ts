import type { KitsuEpisode } from "@/lib/providers/kitsu";
import { animeSeasonKey } from "./anime-season-key";

export type AnimeUpToTarget = {
  metaId?: string;
  season: number;
  episode: number;
  absoluteNumber?: number;
};

/**
 * Cours repeat episode numbers under different source entries, so "up to here"
 * follows the displayed order instead of comparing season/episode numbers.
 */
export function animeUpToEpisodeSlice(
  episodes: KitsuEpisode[],
  anchorMetaId: string,
  target: AnimeUpToTarget,
): KitsuEpisode[] {
  const sourceMetaId = target.metaId ?? anchorMetaId;
  const index = episodes.findIndex(
    (ep) =>
      (ep.sourceMetaId ?? anchorMetaId) === sourceMetaId &&
      animeSeasonKey(ep) === target.season &&
      ep.number === target.episode &&
      (target.absoluteNumber == null || (ep.absoluteNumber ?? ep.number) === target.absoluteNumber),
  );
  return index < 0 ? [] : episodes.slice(0, index + 1);
}
