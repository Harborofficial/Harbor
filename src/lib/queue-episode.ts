import type { PlayEpisode } from "@/lib/view";

type EpisodePoint = Pick<PlayEpisode, "season" | "episode">;

type QueueEpisodeOptions = {
  explicitEpisode?: PlayEpisode;
  episodes: PlayEpisode[];
  progress: EpisodePoint | null;
  isWatched: (season: number, episode: number) => boolean;
  now?: number;
};

export function selectQueueEpisode({
  explicitEpisode,
  episodes,
  progress,
  isWatched,
  now = Date.now(),
}: QueueEpisodeOptions): PlayEpisode | null {
  if (explicitEpisode) return explicitEpisode;

  const ordered = episodes
    .filter((episode) => episode.season >= 1 && episode.episode >= 1)
    .slice()
    .sort((a, b) => a.season - b.season || a.episode - b.episode);

  const startIndex = progress
    ? ordered.findIndex(
        (episode) => episode.season === progress.season && episode.episode === progress.episode,
      )
    : 0;

  // An unmatched progress point must not silently restart the series.
  if (startIndex < 0) return null;

  for (let index = startIndex; index < ordered.length; index++) {
    const episode = ordered[index];
    const airedAt = episode.airDate ? Date.parse(episode.airDate) : NaN;

    if (Number.isFinite(airedAt) && airedAt > now) continue;
    if (isWatched(episode.season, episode.episode)) continue;

    return episode;
  }

  return null;
}
