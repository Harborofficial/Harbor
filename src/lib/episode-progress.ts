import { manualWatchedState, createManualWatchedReader } from "@/lib/manual-watched";
import { lastPlayedEpisode, readResumeEntry, createResumeReader } from "@/lib/resume";
import { pmdbUsesAbsoluteOrder } from "@/lib/publicmetadb/watched-order";

export type EpisodeProgress = {
  ratio: number;
  watched: boolean;
  startedAt: number;
};

const WATCHED_THRESHOLD = 0.85;

export function createEpisodeProgressSnapshot() {
  return { manualWatchedState: createManualWatchedReader(), readResumeEntry: createResumeReader() };
}

export function resumeDefaultSeason(
  seriesId: string,
  seasons: { seasonNumber: number; episodeCount: number }[],
  stremioWatched?: Set<string>,
  lastPlayedSeasonHint?: number | null,
): number {
  const real = seasons
    .filter((s) => s.seasonNumber >= 1)
    .sort((a, b) => a.seasonNumber - b.seasonNumber);
  const first = real[0]?.seasonNumber ?? seasons[0]?.seasonNumber ?? 1;

  if (real.length <= 1) return first;

  const watchedInSeason = (sn: number): number => {
    if (!stremioWatched || stremioWatched.size === 0) return 0;
    let n = 0;
    const prefix = `${sn}:`;
    for (const k of stremioWatched) if (k.startsWith(prefix)) n += 1;
    return n;
  };
  const seasonDone = (s: { seasonNumber: number; episodeCount: number }): boolean =>
    s.episodeCount > 0 && watchedInSeason(s.seasonNumber) >= s.episodeCount;

  const nextUnwatched = real.find((s) => !seasonDone(s))?.seasonNumber ?? null;

  const latestWatchedSeason =
    real.filter((season) => watchedInSeason(season.seasonNumber) > 0).at(-1)?.seasonNumber ?? null;

  const localLastPlayedSeason = lastPlayedEpisode(seriesId)?.season ?? null;

  const hint =
    lastPlayedSeasonHint != null &&
    real.some((season) => season.seasonNumber === lastPlayedSeasonHint)
      ? lastPlayedSeasonHint
      : localLastPlayedSeason != null &&
          real.some((season) => season.seasonNumber === localLastPlayedSeason)
        ? localLastPlayedSeason
        : latestWatchedSeason;

  if (hint != null && real.some((s) => s.seasonNumber === hint)) {
    const hintObj = real.find((s) => s.seasonNumber === hint)!;
    if (seasonDone(hintObj) && nextUnwatched != null && nextUnwatched > hint) return nextUnwatched;
    return hint;
  }

  return nextUnwatched ?? real[real.length - 1]?.seasonNumber ?? first;
}

export function getEpisodeProgress(
  resumeId: string,
  season: number,
  episode: number,
  runtimeMin: number | null,
  traktImdbId: string | null,
  traktWatched: Set<string>,
  stremioWatched?: Set<string>,
  anilistWatched?: Set<string>,
  simklWatched?: Set<string>,
  malWatched?: Set<string>,
  traktSeason?: number,
  traktEpisode?: number,
  pmdbWatched?: Set<string>,
  absoluteNumber?: number,
  local?: ReturnType<typeof createEpisodeProgressSnapshot>,
): EpisodeProgress {
  const readResume = local?.readResumeEntry ?? readResumeEntry;
  const readManual = local?.manualWatchedState ?? manualWatchedState;
  const animeId = /^(kitsu|mal|anilist|anidb):/.test(resumeId);
  const hasMapping =
    typeof traktSeason === "number" &&
    Number.isInteger(traktSeason) &&
    traktSeason >= 0 &&
    typeof traktEpisode === "number" &&
    Number.isInteger(traktEpisode) &&
    traktEpisode > 0;
  const providerCoordinates = !animeId || hasMapping;
  const canonS = providerCoordinates ? (traktSeason ?? season) : season;
  const canonE = providerCoordinates ? (traktEpisode ?? episode) : episode;
  const canonDiffers = canonS !== season || canonE !== episode;
  const imdbAlias = providerCoordinates && traktImdbId !== resumeId ? traktImdbId : null;
  // The primary ID owns the supplied storage coordinates. Only aliases use the mapping.
  const resumeTargets: Array<[string, number, number]> = [[resumeId, season, episode]];
  if (imdbAlias) resumeTargets.push([imdbAlias, canonS, canonE]);
  let entry: { ms: number; t: number; pct?: number } | null = null;
  for (const [id, s, eNum] of resumeTargets) {
    const e = readResume(id, s, eNum);
    if (e && (!entry || e.t > entry.t)) entry = e;
  }
  const startedAt = entry?.t ?? 0;

  const manualSelf = readManual(resumeId, season, episode, imdbAlias ? [resumeId, imdbAlias] : [resumeId]);
  const manualCanon = canonDiffers ? readManual(resumeId, canonS, canonE, imdbAlias ? [resumeId, imdbAlias] : [resumeId]) : undefined;
  const manual = manualSelf !== undefined ? manualSelf : manualCanon;
  if (manual === false) return { ratio: 0, watched: false, startedAt };

  const durationMs = runtimeMin && runtimeMin > 0 ? runtimeMin * 60 * 1000 : 0;
  const pct = entry?.pct;
  const usePct = typeof pct === "number" && Number.isFinite(pct) && durationMs > 0;
  const ms = usePct ? pct * durationMs : (entry?.ms ?? 0);
  const ratio = usePct
    ? Math.min(1, Math.max(0, pct))
    : durationMs > 0 && ms > 0
      ? Math.min(1, ms / durationMs)
      : 0;

  const traktKey =
    providerCoordinates && traktImdbId ? `imdb:${traktImdbId}:${canonS}:${canonE}` : null;
  const traktDone = traktKey ? traktWatched.has(traktKey) : false;
  const stremioDone = stremioWatched ? stremioWatched.has(`${season}:${episode}`) : false;
  const anilistDone = anilistWatched ? anilistWatched.has(`${season}:${episode}`) : false;
  const simklDone = simklWatched ? simklWatched.has(`${season}:${episode}`) : false;
  const malDone = malWatched ? malWatched.has(`${season}:${episode}`) : false;
  const hasAbs =
    (!canonDiffers || pmdbUsesAbsoluteOrder(pmdbWatched)) &&
    absoluteNumber != null &&
    Number.isFinite(absoluteNumber) &&
    absoluteNumber > 0;
  const pmdbDone =
    pmdbWatched && providerCoordinates
      ? pmdbWatched.has(`${canonS}:${canonE}`) ||
        (hasAbs ? pmdbWatched.has(`1:${absoluteNumber}`) : false) ||
        (traktImdbId
          ? pmdbWatched.has(`imdb:${traktImdbId}:${canonS}:${canonE}`) ||
            (hasAbs ? pmdbWatched.has(`imdb:${traktImdbId}:1:${absoluteNumber}`) : false)
          : false) ||
        (resumeId.startsWith("tmdb:tv:")
          ? pmdbWatched.has(`${resumeId}:${canonS}:${canonE}`) ||
            (hasAbs ? pmdbWatched.has(`${resumeId}:1:${absoluteNumber}`) : false)
          : false)
      : false;
  const manualDone =
    manual === true || (imdbAlias != null && readManual(imdbAlias, canonS, canonE) === true);
  const done =
    manualDone || traktDone || stremioDone || anilistDone || simklDone || malDone || pmdbDone;

  return {
    ratio: done ? 1 : ratio,
    watched: done || ratio >= WATCHED_THRESHOLD,
    startedAt,
  };
}

export function formatRelativeWatched(ts: number): string {
  if (!ts) return "";
  const now = Date.now();
  const diffMs = Math.max(0, now - ts);
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour}h ago`;
  const day = Math.floor(hour / 24);
  if (day === 1) return "yesterday";
  if (day < 7) return `${day} days ago`;
  if (day < 14) return "last week";
  if (day < 30) return `${Math.floor(day / 7)} weeks ago`;
  if (day < 365) {
    const month = Math.floor(day / 30);
    return month === 1 ? "last month" : `${month} months ago`;
  }
  const year = Math.floor(day / 365);
  return year === 1 ? "last year" : `${year} years ago`;
}
