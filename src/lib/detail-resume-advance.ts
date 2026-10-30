import { manualWatchedState } from "@/lib/manual-watched";
import { readResumeEntry } from "@/lib/resume";

const FINISHED_RATIO = 0.9;

export type EpisodePoint = { season: number; episode: number };

type EpisodeRef = {
  season?: number | null;
  episode?: number | null;
  number?: number | null;
};

export function isEpisodeFinished(
  metaId: string,
  at: EpisodePoint,
  stremioWatched?: Set<string>,
): boolean {
  const manual = manualWatchedState(metaId, at.season, at.episode);
  if (manual !== undefined) return manual;
  if (stremioWatched?.has(`${at.season}:${at.episode}`)) return true;
  const entry = readResumeEntry(metaId, at.season, at.episode);
  if (!entry || entry.ms <= 0) return false;
  return typeof entry.pct === "number" && entry.pct >= FINISHED_RATIO;
}

export function advancePastFinished(
  metaId: string,
  at: EpisodePoint,
  videos: EpisodeRef[] | undefined,
  stremioWatched?: Set<string>,
): EpisodePoint | null {
  if (!isEpisodeFinished(metaId, at, stremioWatched)) return at;
  const ordered = (videos ?? [])
    .map((v) => ({ season: v.season ?? 1, episode: v.episode ?? v.number ?? 0 }))
    .filter((v) => v.season >= 1 && v.episode >= 1)
    .sort((a, b) => a.season - b.season || a.episode - b.episode);
  const idx = ordered.findIndex((v) => v.season === at.season && v.episode === at.episode);
  if (idx < 0) return at;
  for (let i = idx + 1; i < ordered.length; i += 1) {
    if (!isEpisodeFinished(metaId, ordered[i], stremioWatched)) return ordered[i];
  }
  return null;
}
