import type { PlayEpisode, PlayerStreamRef } from "@/lib/view";
import type { ScoredStream } from "@/lib/streams/types";
import { episodeSpanContains } from "@/lib/episode-span";
import { engineP2pEligible } from "@/lib/torrent/stremio-stream";
import { isLocalUrl } from "@/lib/player/local-url";
import type { DownloadItem } from "@/lib/download/downloads-store";
import {
  findPreferredSourceMatch,
  streamMatchesPreferredSource,
  type PlaybackEntry,
} from "@/lib/playback-history";

/** Use the file's saved release identity or the last online release when playing
 * offline. A local pathname is never itself a streaming source. */
export function preDownloadSourceForPlayback(
  playingUrl: string,
  currentSource: PlayerStreamRef | null | undefined,
  saved: Pick<DownloadItem, "sourceRef" | "torrentInfoHash"> | null | undefined,
  remembered: PlaybackEntry | null,
): PlayerStreamRef | null {
  if (!isLocalUrl(playingUrl) && hasReusableEpisodeSource(currentSource))
    return currentSource ?? null;
  if (isLocalUrl(playingUrl) && hasReusableEpisodeSource(saved?.sourceRef))
    return saved?.sourceRef ?? null;
  if (hasReusableEpisodeSource(remembered)) return remembered;
  if (isLocalUrl(playingUrl) && saved?.torrentInfoHash) return { infoHash: saved.torrentInfoHash };
  return null;
}

/** Pre-download must identify an actual release or season pack, not just its addon. */
export function hasReusableEpisodeSource(ref: PlayerStreamRef | null | undefined): boolean {
  return !!(ref?.infoHash || ref?.bingeGroup || ref?.releaseGroup);
}

/** Find the next episode's equivalent release using the same matcher as Keep Same Source.
 * Never silently substitute a different release just because the addon matches. */
export function matchingPreDownloadStream(
  streams: readonly ScoredStream[],
  ref: PlayerStreamRef | null | undefined,
  episode: PlayEpisode,
): ScoredStream | null {
  if (!hasReusableEpisodeSource(ref) || !ref) return null;
  const source: PlaybackEntry = {
    infoHash: ref.infoHash,
    addonId: ref.addonId,
    resolution: ref.resolution,
    releaseGroup: ref.releaseGroup,
    source: ref.source,
    audioLanguages: ref.audioLanguages,
    bingeGroup: ref.bingeGroup,
    savedAt: 0,
  };
  return findPreferredSourceMatch(
    eligiblePreDownloadStreams(streams, episode),
    source,
    streamMatchesPreferredSource,
  );
}

/** Only used when an offline episode has no remembered online release at all. */
export function bestAvailablePreDownloadStream(
  streams: readonly ScoredStream[],
  episode: PlayEpisode,
): ScoredStream | null {
  // The picker is already scored, filtered, and ordered for the requested episode.
  return eligiblePreDownloadStreams(streams, episode)[0] ?? null;
}

function eligiblePreDownloadStreams(
  streams: readonly ScoredStream[],
  episode: PlayEpisode,
): ScoredStream[] {
  return streams.filter((stream) => {
    if (stream.externalUrl && !stream.url) return false;
    if ((!stream.url || stream.url === "#") && !engineP2pEligible(stream)) return false;
    if (stream.episode != null) {
      if (stream.season != null) {
        if (!episodeSpanContains(stream, episode.season, episode.episode)) return false;
      } else if (stream.episode !== episode.episode) return false;
    }
    return true;
  });
}

export function downloadSourceRef(stream: ScoredStream): PlayerStreamRef {
  return {
    infoHash: stream.infoHash ?? null,
    fileIdx: stream.fileIdx ?? null,
    addonId: stream.addonId ?? null,
    name: stream.name ?? null,
    addonName: stream.addonName ?? null,
    title: stream.title ?? null,
    parsedTitle: stream.parsedTitle ?? null,
    resolution: stream.resolution ?? null,
    releaseGroup: stream.releaseGroupNormalized ?? null,
    source: stream.source ?? null,
    audioLanguages: stream.audioLanguages ?? null,
    bingeGroup: stream.behaviorHints?.bingeGroup ?? null,
    size: stream.size ?? null,
  };
}
