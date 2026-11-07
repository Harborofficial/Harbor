import type { PlayEpisode } from "@/lib/view";

/** True when the target is the newest episode that has already aired. */
export function isLastAiredEpisode(
  episodes: PlayEpisode[],
  target: PlayEpisode,
  now = Date.now(),
): boolean {
  let latest: PlayEpisode | null = null;
  for (const episode of episodes) {
    const aired = Date.parse(episode.airDate ?? "");
    if (!Number.isFinite(aired) || aired > now) continue;
    if (
      !latest ||
      episode.season > latest.season ||
      (episode.season === latest.season && episode.episode > latest.episode)
    ) {
      latest = episode;
    }
  }
  return latest !== null && latest.season === target.season && latest.episode === target.episode;
}
