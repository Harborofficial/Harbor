import { PmdbApiError, pmdbRequest } from "./client";
import { markPmdbWatched } from "./history";
import { getTmdbForExternal } from "./mappings";
import { isAuthenticated } from "./session";
import type { PmdbResumeResponse, PmdbSaveResumeResponse, PmdbTarget } from "./types";

const RESUME_LOOKUP_PER_PAGE = 100;
// The conflicting point was written moments ago, so it sits on the first
// pages. Bound the scan: every page is a request against the hourly budget.
const RESUME_LOOKUP_MAX_PAGES = 3;
const RESUME_DELETE_MAX_PAGES = 25;

function resumeSeasonEpisode(target: PmdbTarget): { season: number; episode: number } {
  if (target.media_type === "movie") return { season: 0, episode: 0 };
  return { season: target.season ?? 0, episode: target.episode ?? 0 };
}

function resumeBody(target: PmdbTarget, positionMs: number, runtimeMs: number) {
  const { season, episode } = resumeSeasonEpisode(target);
  return {
    tmdb_id: target.tmdb_id,
    media_type: target.media_type,
    season,
    episode,
    position_ms: Math.round(positionMs),
    runtime_ms: Math.round(runtimeMs),
    id_type: target.id_type,
    id_value: target.id_value,
  };
}

function isSameResumePoint(
  tmdbId: number | undefined,
  mediaType: string,
  season: number,
  episode: number,
  isMovie: boolean,
): (i: { tmdb_id: number; media_type: string; season?: number | null; episode?: number | null }) => boolean {
  return (i) => {
    if (tmdbId == null || i.tmdb_id !== tmdbId || i.media_type !== mediaType) return false;
    const iSeason = Number(i.season ?? 0);
    const iEpisode = Number(i.episode ?? 0);
    return isMovie ? iSeason === 0 && iEpisode === 0 : iSeason === season && iEpisode === episode;
  };
}

async function findResumeId(target: PmdbTarget): Promise<string | null> {
  let tmdbId = target.tmdb_id;
  if (tmdbId == null) {
    if (!target.id_type || !target.id_value) return null;
    const found = await getTmdbForExternal(target.id_type, target.id_value).catch(() => null);
    if (!found || (found.media_type && found.media_type !== target.media_type)) return null;
    tmdbId = found.tmdb_id;
  }
  const { season, episode } = resumeSeasonEpisode(target);
  const isMovie = target.media_type === "movie";
  const match = isSameResumePoint(tmdbId, target.media_type, season, episode, isMovie);
  for (let page = 1; page <= RESUME_LOOKUP_MAX_PAGES; page++) {
    try {
      const list = await pmdbRequest<PmdbResumeResponse>(
        `/api/external/resume?page=${page}&perPage=${RESUME_LOOKUP_PER_PAGE}`,
        { method: "GET" },
      );
      const found = list?.items?.find(match);
      if (found?.id) return found.id;
      const totalPages = Math.max(1, Number(list?.totalPages ?? 1) || 1);
      if (page >= totalPages || !Array.isArray(list?.items) || list.items.length === 0) return null;
    } catch {
      return null;
    }
  }
  return null;
}

export async function pmdbDeleteResumeForTarget(target: PmdbTarget): Promise<boolean> {
  const id = await findResumeId(target);
  if (!id) return false;
  return pmdbDeleteResume(id);
}

export async function pmdbDeleteResumesForTitle(
  target: PmdbTarget,
  options: { assertCurrent?: () => void } = {},
): Promise<number> {
  if (!isAuthenticated()) return 0;
  options.assertCurrent?.();
  let tmdbId = target.tmdb_id;
  if (tmdbId == null) {
    if (!target.id_type || !target.id_value) return 0;
    const found = await getTmdbForExternal(target.id_type, target.id_value).catch(() => null);
    options.assertCurrent?.();
    if (!found || (found.media_type && found.media_type !== target.media_type)) return 0;
    tmdbId = found.tmdb_id;
  }
  if (!Number.isInteger(tmdbId) || tmdbId <= 0) return 0;

  const ids: string[] = [];
  for (let page = 1; page <= RESUME_DELETE_MAX_PAGES; page++) {
    options.assertCurrent?.();
    const list = await pmdbRequest<PmdbResumeResponse>(
      `/api/external/resume?page=${page}&perPage=${RESUME_LOOKUP_PER_PAGE}`,
      { method: "GET" },
    );
    options.assertCurrent?.();
    if (!Array.isArray(list?.items)) throw new Error("PublicMetaDB resume state could not be read safely.");
    for (const item of list.items) {
      if (item.tmdb_id === tmdbId && item.media_type === target.media_type && item.id) ids.push(item.id);
    }
    const totalPages = Math.max(1, Number(list?.totalPages ?? 1) || 1);
    if (totalPages > RESUME_DELETE_MAX_PAGES)
      throw new Error("PublicMetaDB has too many resume pages to clear safely.");
    if (page >= totalPages || list.items.length === 0) break;
  }

  for (const id of ids) {
    options.assertCurrent?.();
    const ok = await pmdbDeleteResume(id);
    options.assertCurrent?.();
    if (!ok) throw new Error("PublicMetaDB did not confirm resume removal.");
  }
  return ids.length;
}

export async function pmdbSaveResume(
  target: PmdbTarget,
  positionMs: number,
  runtimeMs: number,
  isRetry = false,
): Promise<PmdbSaveResumeResponse | null> {
  if (!isAuthenticated()) return null;

  try {
    const res = await pmdbRequest<PmdbSaveResumeResponse>("/api/external/resume", {
      method: "POST",
      body: resumeBody(target, positionMs, runtimeMs),
    });

    if (res?.action === "completed") {
      void markPmdbWatched(target).then(() => {
        void pmdbDeleteResumeForTarget(target);
      });
    }

    return res;
  } catch (err) {
    if (!isRetry && err instanceof PmdbApiError && err.status === 409) {
      try {
        const id = await findResumeId(target);
        if (id) {
          await pmdbDeleteResume(id);
          return await pmdbSaveResume(target, positionMs, runtimeMs, true);
        }
      } catch (recoveryErr) {
        console.error("PublicMetaDB 409 recovery failed:", recoveryErr);
      }
    }
    console.error("PublicMetaDB resume save failed:", err);
    return null;
  }
}

export async function pmdbDeleteResume(resumeId: string): Promise<boolean> {
  if (!isAuthenticated() || !resumeId) return false;

  try {
    await pmdbRequest(`/api/external/resume/${encodeURIComponent(resumeId)}`, {
      method: "DELETE",
    });
    return true;
  } catch (err) {
    console.error("PublicMetaDB resume delete failed:", err);
    return false;
  }
}
