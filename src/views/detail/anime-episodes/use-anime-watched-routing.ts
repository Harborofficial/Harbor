import { useMemo } from "react";
import type { Meta } from "@/lib/cinemeta";
import type { FranchiseEntry } from "@/lib/providers/anime-detail";
import type { KitsuEpisode } from "@/lib/providers/kitsu";
import {
  recordManualWatchedMeta,
  setManualWatchedMany,
  type ManualWatchedMeta,
} from "@/lib/manual-watched";
import { syncAnimeProgress } from "@/lib/anilist/sync";
import { syncMalProgress } from "@/lib/mal/sync";
import { useSettings } from "@/lib/settings";
import { isNuvioSignedIn, isNuvioProviderActive } from "@/lib/nuvio/nuvio-client";
import {
  resolveNuvioProfileIndex,
  pushWatchedItemToNuvio,
  deleteWatchedItemFromNuvio,
  deleteEpisodeWatchProgressFromNuvio,
  undismissNextUpInNuvioCloud,
} from "@/lib/nuvio/nuvio-sync";
import { undismissCw } from "@/lib/cw-dismiss";
import { airedOnly } from "../helpers";
import { animeSeasonKey } from "./anime-season-key";

const ANIME_TRACK_ID = /^(kitsu|mal|anilist|anidb):/;

export function useAnimeWatchedRouting(meta: Meta, franchise: FranchiseEntry[], trackId?: string) {
  const { settings } = useSettings();
  const byId = useMemo(() => {
    const m = new Map<string, Meta>();
    for (const f of franchise) m.set(f.meta.id, f.meta);
    return m;
  }, [franchise]);

  const metaForEp = (ep: KitsuEpisode): Meta => {
    if (!ep.sourceMetaId) return meta;
    return byId.get(ep.sourceMetaId) ?? { id: ep.sourceMetaId, type: "series", name: meta.name };
  };

  const manualMetaFor = (metaId: string): ManualWatchedMeta => {
    const m = metaId === meta.id ? meta : (byId.get(metaId) ?? meta);
    return { type: "series", name: m.name, poster: m.poster, background: m.background };
  };

  const markMany = (displayEpisodes: KitsuEpisode[], watched: boolean) => {
    const eligible = watched ? airedOnly(displayEpisodes, (ep) => ep.airdate) : displayEpisodes;
    if (eligible.length === 0) return;
    const groups = new Map<string, Array<{ season: number; episode: number }>>();
    for (const ep of eligible) {
      const id = ep.sourceMetaId ?? meta.id;
      const list = groups.get(id) ?? [];
      const primaryS = animeSeasonKey(ep);
      const primaryE = ep.number;
      list.push({ season: primaryS, episode: primaryE });
      if (ep.imdbSeason != null && ep.imdbEpisode != null && (ep.imdbSeason !== primaryS || ep.imdbEpisode !== primaryE)) {
        list.push({ season: ep.imdbSeason, episode: ep.imdbEpisode });
      }
      if (primaryS !== 1 && ep.number > 0) {
        list.push({ season: 1, episode: ep.number });
      }
      groups.set(id, list);
    }
    for (const [id, eps] of groups) {
      if (watched) recordManualWatchedMeta(id, manualMetaFor(id));
      setManualWatchedMany(id, eps, watched);
      const syncId =
        id === meta.id && trackId && ANIME_TRACK_ID.test(trackId) && !ANIME_TRACK_ID.test(id)
          ? trackId
          : id;
      if (watched && ANIME_TRACK_ID.test(syncId)) {
        const highest = Math.max(...eps.map((e) => e.episode));
        if (Number.isFinite(highest) && highest > 0) {
          const title = manualMetaFor(id).name;
          if (settings.anilistAutoSync)
            void syncAnimeProgress(
              syncId,
              highest,
              title,
              undefined,
              settings.anilistCountRewatches,
            );
          if (settings.malAutoSync)
            void syncMalProgress(
              syncId,
              highest,
              title,
              undefined,
              settings.malCountRewatches,
            );
        }
      }
      if (isNuvioSignedIn() && isNuvioProviderActive() && eps.length > 0) {
        const slot = resolveNuvioProfileIndex();
        const clean = id.replace(/^(series|movie|tmdb):/, "");
        const idVariants = Array.from(new Set([id, clean, `tmdb:${clean}`, `series:${clean}`]));
        const primaryId = id;
        if (watched) {
          undismissCw(primaryId);
          void undismissNextUpInNuvioCloud(slot, primaryId);
          const items = eps.flatMap((e) =>
            idVariants.map((cid) => ({
              contentId: cid,
              contentType: "series" as const,
              title: manualMetaFor(id).name,
              season: e.season,
              episode: e.episode,
              watchedAt: Date.now(),
            })),
          );
          void pushWatchedItemToNuvio(slot, items);
          for (const ep of eps) {
            void deleteEpisodeWatchProgressFromNuvio(slot, primaryId, ep.season, ep.episode);
          }
        } else {
          const keys = eps.flatMap((e) =>
            idVariants.map((cid) => ({
              contentId: cid,
              season: e.season,
              episode: e.episode,
            })),
          );
          void deleteWatchedItemFromNuvio(slot, keys);
        }
      }
    }
  };

  return { metaForEp, manualMetaFor, markMany };
}
