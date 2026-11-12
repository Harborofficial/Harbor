import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useProfiles } from "./profiles";
import { useTrackerStatusVersion } from "./tracker-status-events";
import { usePmdbListsVersion } from "./publicmetadb/list-hooks";
import {
  getSession as getPmdbSession,
  subscribeSession as subscribePmdb,
} from "./publicmetadb/session";
import { getSession as getTraktSession, subscribeSession as subscribeTrakt } from "./trakt/session";
import { getSession as getSimklSession, subscribeSession as subscribeSimkl } from "./simkl/session";
import { getSession as getMalSession, subscribeSession as subscribeMal } from "./mal/session";
import {
  getSession as getAnilistSession,
  subscribeSession as subscribeAnilist,
} from "./anilist/session";
import { resolveMalMediaId, fetchListEntry as fetchMalEntry } from "./mal/mutations";
import { resolveAnilistMediaId } from "./anilist/sync";
import { fetchListEntry as fetchAnilistEntry } from "./anilist/mutations";
import { resolveSimklTarget } from "./simkl/ids";
import { readSimklStateStrict } from "./simkl/list-status";
import { resolvePmdbTarget } from "./publicmetadb/ids";
import { getTmdbForExternal } from "./publicmetadb/mappings";
import { fetchPmdbWatchedKeySet } from "./publicmetadb/history";
import { fetchPmdbWatchlist, pmdbWatchlistContains } from "./publicmetadb/watchlist";
import { getPmdbDefaultListId } from "./publicmetadb/lists";
import { stremioIdToTraktTarget } from "./trakt/ids";
import { traktRequest } from "./trakt/client";

type TrackedShow = {
  id: string;
  type: string;
  imdbId?: string | null;
  animeId?: string | null;
};

const isAnimeId = (id: string) => /^(mal|anilist|kitsu|anidb):/.test(id);

function traktShowMatches(
  rows: { show?: { ids?: { imdb?: string; tmdb?: number } } }[],
  ids: { imdb?: string; tmdb?: number },
): boolean {
  return rows.some(
    ({ show }) =>
      !!show?.ids &&
      ((!!ids.imdb && show.ids.imdb === ids.imdb) ||
        (ids.tmdb != null && show.ids.tmdb === ids.tmdb)),
  );
}

/** Read real remote tracking evidence, never infer tracking merely from a connected account. */
export async function isShowTracked(input: TrackedShow): Promise<boolean> {
  if (input.type === "movie" || input.type === "manga" || !input.id) return false;
  const id = input.animeId && isAnimeId(input.animeId) ? input.animeId : input.id;
  const anime = input.type === "anime" || isAnimeId(id);
  const jobs: Array<Promise<boolean>> = [];

  if (anime && getMalSession())
    jobs.push(
      (async () => {
        const malId = await resolveMalMediaId(id);
        return malId != null && (await fetchMalEntry(malId)).entry != null;
      })(),
    );

  if (anime && getAnilistSession())
    jobs.push(
      (async () => {
        const mediaId = await resolveAnilistMediaId(id);
        return mediaId != null && (await fetchAnilistEntry(mediaId)).entry != null;
      })(),
    );

  if (getSimklSession())
    jobs.push(
      (async () => {
        const target =
          (await resolveSimklTarget(id, "series")) ??
          (input.imdbId ? await resolveSimklTarget(input.imdbId, "series") : null);
        if (!target) return false;
        const state = await readSimklStateStrict(target);
        return state.status != null || state.watched.size > 0;
      })(),
    );

  if (getPmdbSession())
    jobs.push(
      (async () => {
        let target =
          (await resolvePmdbTarget(id, "series")) ??
          (input.imdbId ? await resolvePmdbTarget(input.imdbId, "series") : null);
        if (target?.media_type !== "tv") return false;
        if (target.tmdb_id == null && target.id_type && target.id_value) {
          const mapped = await getTmdbForExternal(target.id_type, target.id_value);
          target = mapped ? { ...target, tmdb_id: mapped.tmdb_id } : null;
        }
        if (!target?.tmdb_id) return false;
        // Watching one episode counts without a watchlist entry; a watchlist entry also counts
        // when history is empty or temporarily unavailable. A failed read is not absence.
        const checks = await Promise.allSettled([
          fetchPmdbWatchedKeySet(target, { strict: true }),
          fetchPmdbWatchlist({ listId: getPmdbDefaultListId(), strict: true }),
        ]);
        return (
          (checks[0].status === "fulfilled" && checks[0].value.size > 0) ||
          (checks[1].status === "fulfilled" &&
            pmdbWatchlistContains(checks[1].value, target) != null)
        );
      })(),
    );

  if (getTraktSession())
    jobs.push(
      (async () => {
        const idSource = input.imdbId || id;
        const result = stremioIdToTraktTarget(idSource);
        if (!result.ok) return false;
        const ids = result.target.kind === "episode" ? result.target.show.ids : result.target.ids;
        if (!ids.imdb && !ids.tmdb) return false;
        const routes = ["/sync/watchlist/shows", "/sync/watched/shows", "/users/hidden/dropped"];
        const pages = await Promise.allSettled(
          routes.map((route) =>
            traktRequest<Array<{ show?: { ids?: { imdb?: string; tmdb?: number } } }>>(route),
          ),
        );
        return pages.some(
          (page) => page.status === "fulfilled" && traktShowMatches(page.value, ids),
        );
      })(),
    );

  // A positive read is sufficient; do not wait for unrelated, slower connected services.
  if (!jobs.length) return false;
  return Promise.any(
    jobs.map(async (job) => {
      if (await job) return true;
      throw new Error("No tracker entry");
    }),
  ).catch(() => false);
}

/** Hide until a connected tracker confirms actual membership or watched progress. */
export function useCanDropShow(input: TrackedShow | null): boolean {
  const { activeId } = useProfiles();
  const statusVersion = useTrackerStatusVersion();
  const pmdbListVersion = usePmdbListsVersion();
  const pmdb = useSyncExternalStore(subscribePmdb, getPmdbSession);
  const trakt = useSyncExternalStore(subscribeTrakt, getTraktSession);
  const simkl = useSyncExternalStore(subscribeSimkl, getSimklSession);
  const mal = useSyncExternalStore(subscribeMal, getMalSession);
  const anilist = useSyncExternalStore(subscribeAnilist, getAnilistSession);
  const id = input?.id ?? "";
  const type = input?.type ?? "";
  const imdbId = input?.imdbId ?? null;
  const animeId = input?.animeId ?? null;
  const scope = useMemo(
    () => ({}),
    [
      id,
      type,
      imdbId,
      animeId,
      activeId,
      statusVersion,
      pmdbListVersion,
      pmdb,
      trakt,
      simkl,
      mal,
      anilist,
    ],
  );
  const [result, setResult] = useState<{ scope: typeof scope; tracked: boolean } | null>(null);

  useEffect(() => {
    let live = true;
    setResult(null);
    if (id && type !== "movie" && (pmdb || trakt || simkl || mal || anilist)) {
      void isShowTracked({ id, type, imdbId, animeId })
        .then((tracked) => {
          if (live) setResult({ scope, tracked });
        })
        .catch(() => {
          if (live) setResult({ scope, tracked: false });
        });
    }
    return () => {
      live = false;
    };
  }, [scope, id, type, imdbId, animeId, pmdb, trakt, simkl, mal, anilist]);

  // A previously tracked title cannot briefly make the Drop button appear on the next title.
  return Boolean(input && result?.scope === scope && result.tracked);
}
