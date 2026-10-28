import { getAnimeCwId } from "@/lib/anime-cw-ids";
import { isDetectedAnime } from "@/lib/anime-detect";
import { pickEpisodeTitle } from "@/lib/providers/anizip";
import { animeMappingByKitsu } from "@/lib/providers/anime-mapping";
import { resolveAnimeIdentity } from "@/lib/streams/anime-identity";
import { resolveTrackerAnimeEntry } from "@/lib/anime-tracker-entry";
import type { PlayEpisode } from "@/lib/view";

const ANIME_SCHEME = /^(kitsu|mal|anilist|anidb):/;

export type CwAnimeEpisodeQuery = {
  metaId: string;
  videoId?: string | null;
  season?: number;
  episode?: number;
  name?: string | null;
  airDate?: string | null;
  imdbSeason?: number;
  imdbEpisode?: number;
  absoluteNumber?: number | null;
  /** Exact addon video id, e.g. kitsu:45619:1. Avoids sibling-entry guessing. */
  kitsuStreamId?: string;
};

/**
 * True when a row can possibly be an anime. Cheap and local: a Cinemeta row
 * that is neither mapped nor already detected is an ordinary series, and must
 * not pay for an identity lookup.
 */
function looksAnime(metaId: string): boolean {
  if (ANIME_SCHEME.test(metaId)) return true;
  return getAnimeCwId(metaId) != null || isDetectedAnime(metaId);
}

/**
 * Resolve the episode identity a Continue Watching launch must hand to the
 * player.
 *
 * It goes through `resolveAnimeIdentity`, the same resolver the stream picker
 * uses, so a split series (Bleach TYBW, JoJo) lands on the cour that actually
 * aired the season rather than the row's own base entry. The result carries the
 * entry-relative stream id (what the picker queries) plus the provider
 * coordinates and title the trackers and the Discord presence need.
 */
export async function resolveCwAnimePlayEpisode(
  query: CwAnimeEpisodeQuery,
): Promise<PlayEpisode | null> {
  // A saved stream names the played cour, while a catalog id may name the
  // franchise's first entry. Do not reinterpret entry-relative S1 as provider S1.
  const saved = /^kitsu:([1-9]\d*):([1-9]\d*)$/.exec(query.videoId ?? "") ??
    /^kitsu:([1-9]\d*):([1-9]\d*)$/.exec(query.kitsuStreamId ?? "");
  if (!saved && !looksAnime(query.metaId)) return null;
  const coords = {
    season: query.season,
    episode: query.episode,
    imdbSeason: query.imdbSeason,
    imdbEpisode: query.imdbEpisode,
  };
  let identity = saved
    ? { kitsuId: Number(saved[1]), number: Number(saved[2]), streamId: saved[0] }
    : await resolveAnimeIdentity(query.metaId, null, coords).catch(() => null);
  // New sequels may not have provider mappings yet. Use the same franchise
  // resolution as tracking and CW advancement rather than stamping the base id.
  if (!identity) {
    const entry = await resolveTrackerAnimeEntry(query.metaId, coords).catch(() => null);
    const kitsu = /^kitsu:(\d+)$/.exec(entry?.id ?? "");
    if (entry && kitsu) {
      identity = {
        kitsuId: Number(kitsu[1]),
        number: entry.episode,
        streamId: `${entry.id}:${entry.episode}`,
      };
    }
  }
  if (!identity) return null;
  const az = await animeMappingByKitsu(identity.kitsuId).catch(() => null);
  const azEp = az?.episodes?.[String(identity.number)];
  return {
    season: query.season ?? 1,
    episode: saved ? identity.number : (query.episode ?? identity.number),
    name: pickEpisodeTitle(azEp) ?? query.name ?? undefined,
    still: azEp?.image ?? undefined,
    overview: azEp?.overview || undefined,
    kitsuStreamId: identity.streamId,
    // Name the cour the stream belongs to, so a tracker counts its episodes
    // instead of the parent series'.
    sourceMetaId: `kitsu:${identity.kitsuId}`,
    imdbId: az?.mappings?.imdb_id,
    imdbSeason: azEp?.seasonNumber ?? query.imdbSeason,
    imdbEpisode: azEp?.episodeNumber ?? query.imdbEpisode,
    absoluteNumber: azEp?.absoluteEpisodeNumber ?? query.absoluteNumber ?? undefined,
    tvdbEpisodeId: azEp?.tvdbId,
    airDate: azEp?.airDate ?? azEp?.airdate ?? query.airDate ?? undefined,
    runtime: azEp?.runtime,
  };
}
