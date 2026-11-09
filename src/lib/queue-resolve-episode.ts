import type { Meta } from "@/lib/cinemeta";
import type { PlayEpisode } from "@/lib/view";
import { localWatched, readContextWatchedSnapshot } from "@/lib/context-watched-state";
import { fetchEpisodeList, isAnimeId } from "@/lib/series-episodes";
import { lastPlayedEpisode } from "@/lib/resume";
import { localCwEntry } from "@/lib/local-cw";
import { episodeFromVideoId, type LibraryItem } from "@/lib/stremio";
import { selectQueueEpisode } from "@/lib/queue-episode";

type ProgressPoint = {
  id: string;
  season: number;
  episode: number;
  t: number;
  finished: boolean;
};

type ResolveQueueEpisodeOptions = {
  meta: Meta;
  explicitEpisode?: PlayEpisode;
  imdbId?: string | null;
  tmdbKey: string;
  libraryItem?: LibraryItem | null;
  privateOnly: boolean;
  isCurrent: () => boolean;
};

export async function resolveQueueEpisode({
  meta,
  explicitEpisode,
  imdbId,
  tmdbKey,
  libraryItem,
  privateOnly,
  isCurrent,
}: ResolveQueueEpisodeOptions): Promise<PlayEpisode | null> {
  if (explicitEpisode) return explicitEpisode;

  const assertCurrent = () => {
    if (!isCurrent()) {
      throw new Error("The queue request is no longer active.");
    }
  };

  assertCurrent();

  const episodeMeta: Meta = meta.type === "anime" ? { ...meta, type: "series" } : meta;
  const episodes = await fetchEpisodeList(episodeMeta, { tmdbKey });
  assertCurrent();

  if (episodes.length === 0) return null;

  const anime = isAnimeId(meta.id) || meta.type === "anime";
  const ids = [...new Set([meta.id, ...(!anime && imdbId ? [imdbId] : [])])];
  const candidates: ProgressPoint[] = [];

  for (const id of ids) {
    const resume = lastPlayedEpisode(id);
    if (resume && resume.ms > 0) {
      candidates.push({
        id,
        season: resume.season,
        episode: resume.episode,
        t: resume.t,
        finished: (resume.pct ?? 0) >= 0.9,
      });
    }

    const local = localCwEntry(id, privateOnly);
    if (
      local?.type === "series" &&
      local.positionMs > 0 &&
      local.season != null &&
      local.episode != null
    ) {
      candidates.push({
        id,
        season: local.season,
        episode: local.episode,
        t: local.t,
        finished: local.durationMs > 0 && local.positionMs / local.durationMs >= 0.9,
      });
    }
  }

  if (!privateOnly && libraryItem && ids.includes(libraryItem._id)) {
    const state = libraryItem.state;
    const parsed = episodeFromVideoId(state?.video_id);
    const season = state?.season ?? parsed?.season;
    const episode = state?.episode ?? parsed?.episode;

    if (
      season != null &&
      episode != null &&
      ((state?.timeOffset ?? 0) > 0 || (state?.flaggedWatched ?? 0) > 0)
    ) {
      const at = Date.parse(state?.lastWatched ?? libraryItem._mtime ?? "");
      const duration = state?.duration ?? 0;
      const offset = state?.timeOffset ?? 0;

      candidates.push({
        id: libraryItem._id,
        season,
        episode,
        t: Number.isFinite(at) ? at : 0,
        finished: duration > 0 ? offset / duration >= 0.9 : (state?.flaggedWatched ?? 0) > 0,
      });
    }
  }

  const latest = candidates
    .filter(
      (point) =>
        Number.isInteger(point.season) &&
        Number.isInteger(point.episode) &&
        point.season >= 1 &&
        point.episode >= 1,
    )
    .sort((a, b) => b.t - a.t)[0];

  const progress = latest
    ? episodes.find(
        (episode) => episode.season === latest.season && episode.episode === latest.episode,
      )
    : null;

  // Do not replace unmatched saved progress with the first episode.
  if (latest && !progress) return null;

  const input = {
    meta: {
      ...episodeMeta,
      videos: episodes.map((episode) => ({
        season: episode.season,
        episode: episode.episode,
        released: episode.airDate,
      })),
    },
    imdbId,
    episodeProjection: episodes,
  };

  const snapshot = privateOnly
    ? { providers: [] }
    : await readContextWatchedSnapshot(input, isCurrent);

  assertCurrent();

  const watched = new Map<string, boolean>();

  for (const episode of episodes) {
    const key = `${episode.season}:${episode.episode}`;
    const local = localWatched({ ...input, episode }, key);
    const current = progress?.season === episode.season && progress?.episode === episode.episode;

    if (local !== undefined) {
      watched.set(key, local);
    } else if (current && latest) {
      watched.set(key, latest.finished);
    } else if (snapshot.providers.some((provider) => provider.watched?.has(key))) {
      watched.set(key, true);
    }
  }

  const selected = selectQueueEpisode({
    episodes,
    progress: progress ?? null,
    isWatched: (season, episode) => watched.get(`${season}:${episode}`) === true,
  });

  if (!selected) return null;

  const key = `${selected.season}:${selected.episode}`;
  if (!watched.has(key) && snapshot.providers.some((provider) => provider.watched === null)) {
    throw new Error("Could not verify episode progress. Try again.");
  }

  return selected;
}
