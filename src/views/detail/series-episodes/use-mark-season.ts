import { useCallback } from "react";
import type { Meta } from "@/lib/cinemeta";
import { recordManualWatchedMeta, setManualWatchedMany } from "@/lib/manual-watched";
import type { Episode } from "@/lib/providers/tmdb";
import { markEpisodesWatched, unmarkEpisodesWatched } from "@/lib/simkl/history";
import { stremioIdToSimklTarget } from "@/lib/simkl/ids";
import { markPmdbWatched, unmarkPmdbWatched } from "@/lib/publicmetadb/history";
import { stremioIdToPmdbTarget } from "@/lib/publicmetadb/ids";
import { usePublicMetaDb } from "@/lib/publicmetadb/provider";
import { isNuvioSignedIn, isNuvioProviderActive } from "@/lib/nuvio/nuvio-client";
import {
  resolveNuvioProfileIndex,
  pushWatchedItemToNuvio,
  deleteWatchedItemFromNuvio,
  deleteWatchProgressFromNuvio,
  pushWatchProgressToNuvio,
} from "@/lib/nuvio/nuvio-sync";
import { saveLocalCw } from "@/lib/local-cw";
import { saveResumeMs } from "@/lib/resume";
import { airedOnly } from "../helpers";

export function useMarkSeason({
  meta,
  active,
  enrichedEpisodes,
  simklConnected,
}: {
  meta: Meta;
  active: number;
  enrichedEpisodes: Episode[];
  simklConnected: boolean;
}): (watched: boolean) => void {
  const { isConnected: pmdbConnected } = usePublicMetaDb();
  return useCallback(
    (watched: boolean) => {
      const airedEpisodes = watched
        ? airedOnly(enrichedEpisodes, (ep) => ep.airDate)
        : enrichedEpisodes;
      if (airedEpisodes.length === 0) return;
      if (watched)
        recordManualWatchedMeta(meta.id, {
          type: "series",
          name: meta.name,
          poster: meta.poster,
          background: meta.background,
        });
      setManualWatchedMany(
        meta.id,
        airedEpisodes.map((ep) => ({ season: ep.seasonNumber, episode: ep.episodeNumber })),
        watched,
      );
      if (isNuvioSignedIn() && isNuvioProviderActive()) {
        const slot = resolveNuvioProfileIndex();
        const primaryId = meta.id;
        if (watched) {
          const items = airedEpisodes.map((e) => ({
            contentId: primaryId,
            contentType: "series" as const,
            title: meta.name,
            season: e.seasonNumber,
            episode: e.episodeNumber,
            watchedAt: Date.now(),
          }));
          void pushWatchedItemToNuvio(slot, items);
          void (async () => {
            await deleteWatchProgressFromNuvio(slot, primaryId);
            const nextSeason = active + 1;
            const metaInfo = {
              title: meta.name,
              name: meta.name,
              poster: meta.poster,
              background: meta.background,
            };
            await pushWatchProgressToNuvio(slot, primaryId, 0, 2640, nextSeason, 1, metaInfo);
            const nextCw = {
              id: meta.id,
              type: "series" as const,
              name: meta.name,
              poster: meta.poster,
              background: meta.background,
              season: nextSeason,
              episode: 1,
              positionMs: 0,
              durationMs: 2640000,
              isAnime: meta.type === "anime",
              t: Date.now(),
            };
            saveLocalCw(nextCw);
            saveLocalCw(nextCw, `nuvio-${slot}`);
            saveResumeMs(meta.id, 0, nextSeason, 1, undefined, 0, "nuvio", `nuvio-${slot}`);
            window.dispatchEvent(new CustomEvent("harbor:continue-watching-updated"));
          })();
        } else {
          const keys = airedEpisodes.map((e) => ({
            contentId: primaryId,
            season: e.seasonNumber,
            episode: e.episodeNumber,
          }));
          void deleteWatchedItemFromNuvio(slot, keys);
          void (async () => {
            const metaInfo = {
              title: meta.name,
              name: meta.name,
              poster: meta.poster,
              background: meta.background,
            };
            await pushWatchProgressToNuvio(slot, primaryId, 0, 2640, active, 1, metaInfo);
            const resetCw = {
              id: meta.id,
              type: "series" as const,
              name: meta.name,
              poster: meta.poster,
              background: meta.background,
              season: active,
              episode: 1,
              positionMs: 0,
              durationMs: 2640000,
              isAnime: meta.type === "anime",
              t: Date.now(),
            };
            saveLocalCw(resetCw);
            saveLocalCw(resetCw, `nuvio-${slot}`);
            saveResumeMs(meta.id, 0, active, 1, undefined, 0, "nuvio", `nuvio-${slot}`);
            window.dispatchEvent(new CustomEvent("harbor:continue-watching-updated"));
          })();
        }
      }
      if (!simklConnected) return;
      const r = stremioIdToSimklTarget(meta.id, { season: active, episode: 1 });
      const showIds =
        r.ok &&
        (r.target.kind === "episode"
          ? r.target.show.ids
          : r.target.kind === "anime-episode"
            ? r.target.anime.ids
            : null);
      if (!showIds) return;
      if (watched) {
        void markEpisodesWatched(
          showIds,
          active,
          airedEpisodes.map((e) => e.episodeNumber),
        );
      } else {
        void unmarkEpisodesWatched(
          showIds,
          active,
          airedEpisodes.map((e) => e.episodeNumber),
        );
      }
      if (pmdbConnected) {
        for (const ep of airedEpisodes) {
          const target = stremioIdToPmdbTarget(
            meta.id,
            { season: ep.seasonNumber, episode: ep.episodeNumber },
            "tv",
          );
          if (target) {
            if (watched) void markPmdbWatched(target);
            else void unmarkPmdbWatched(target);
          }
        }
      }
    },
    [meta, active, enrichedEpisodes, simklConnected, pmdbConnected],
  );
}
