import { useEffect, useState, useSyncExternalStore } from "react";
import type { Meta } from "@/lib/cinemeta";
import { getEpisodeProgress } from "@/lib/episode-progress";
import { manualWatchedVersion, subscribeManualWatched } from "@/lib/manual-watched";
import { loadSimklWatchedMap, simklWatchedForId } from "@/lib/simkl/list-status";
import { useSimkl } from "@/lib/simkl/provider";
import { resolveMeta } from "@/lib/meta-resource";
import { libraryGetOne } from "@/lib/stremio";
import { decodeWatchedEpisodes } from "@/lib/stremio-watched";
import { fetchWatchedKeySet } from "@/lib/trakt/history";
import { useTrakt } from "@/lib/trakt/provider";
import { fetchPmdbWatchedKeySet } from "@/lib/publicmetadb/history";
import { stremioIdToPmdbTarget } from "@/lib/publicmetadb/ids";
import { usePublicMetaDb } from "@/lib/publicmetadb/provider";
import type { PlayEpisode } from "@/lib/view";
import { isNuvioSignedIn, isNuvioProviderActive } from "@/lib/nuvio/nuvio-client";
import { readCachedWatchProgress, resolveNuvioProfileIndex } from "@/lib/nuvio/nuvio-sync";

export function usePlayerWatched(params: {
  meta: Meta;
  authKey: string | null;
  imdbId: string | null;
  enabled: boolean;
}): { watchedFor: (ep: PlayEpisode) => boolean } {
  const { meta, authKey, imdbId, enabled } = params;
  const { isConnected: traktConnected } = useTrakt();
  const { isConnected: simklConnected } = useSimkl();
  const { isConnected: pmdbConnected } = usePublicMetaDb();
  useSyncExternalStore(subscribeManualWatched, manualWatchedVersion);
  const [traktWatched, setTraktWatched] = useState<Set<string>>(() => new Set());
  const [simklWatched, setSimklWatched] = useState<Set<string>>(() => new Set());
  const [pmdbWatched, setPmdbWatched] = useState<Set<string>>(() => new Set());
  const [stremioWatched, setStremioWatched] = useState<Set<string>>(() => new Set());
  const [nuvioWatched, setNuvioWatched] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (!enabled || !traktConnected) return;
    let cancelled = false;
    fetchWatchedKeySet()
      .then((s) => {
        if (!cancelled) setTraktWatched(s);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [enabled, traktConnected, meta.id]);

  useEffect(() => {
    if (!enabled || !simklConnected) return;
    let cancelled = false;
    loadSimklWatchedMap()
      .then((m) => {
        if (!cancelled) setSimklWatched(simklWatchedForId(m, imdbId, meta.id));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [enabled, simklConnected, imdbId, meta.id]);

  useEffect(() => {
    if (!enabled || !pmdbConnected) {
      setPmdbWatched(new Set());
      return;
    }
    let cancelled = false;
    const target = stremioIdToPmdbTarget(meta.id, undefined, "series");
    fetchPmdbWatchedKeySet(target ?? undefined)
      .then((s) => {
        if (!cancelled) setPmdbWatched(s);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [enabled, pmdbConnected, meta.id]);

  useEffect(() => {
    if (!enabled || !isNuvioSignedIn() || !isNuvioProviderActive()) {
      setNuvioWatched(new Set());
      return;
    }
    const updateNuvio = () => {
      const slot = resolveNuvioProfileIndex();
      const records = readCachedWatchProgress(slot);
      const set = new Set<string>();
      for (const r of records) {
        const matches = r.content_id === meta.id || (imdbId && r.content_id === imdbId);
        if (matches && r.season != null && r.episode != null) {
          const ratio = (r.progress_seconds && r.duration_seconds)
            ? r.progress_seconds / r.duration_seconds
            : 0;
          if (ratio >= 0.85) {
            set.add(`${r.season}:${r.episode}`);
          }
        }
      }
      setNuvioWatched(set);
    };
    updateNuvio();
    window.addEventListener("harbor:nuvio-progress-pushed", updateNuvio);
    window.addEventListener("harbor:nuvio-watched-updated", updateNuvio);
    return () => {
      window.removeEventListener("harbor:nuvio-progress-pushed", updateNuvio);
      window.removeEventListener("harbor:nuvio-watched-updated", updateNuvio);
    };
  }, [enabled, meta.id, imdbId]);

  useEffect(() => {
    if (!enabled || !authKey || isNuvioProviderActive()) return;
    let cancelled = false;
    void (async () => {
      const item = await libraryGetOne(authKey, meta.id).catch(() => null);
      const watched = item?.state?.watched;
      if (!watched || cancelled) return;
      const full = await resolveMeta(authKey, "series", meta.id).catch(() => null);
      const keys = await decodeWatchedEpisodes(watched, full?.videos);
      if (!cancelled) setStremioWatched(keys);
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, authKey, meta.id]);

  const imdbKey = meta.id.startsWith("tt") ? meta.id : imdbId;
  const isNuvio = isNuvioProviderActive();
  const watchedFor = (ep: PlayEpisode): boolean => {
    if (isNuvio && nuvioWatched.has(`${ep.season}:${ep.episode}`)) {
      return true;
    }
    return getEpisodeProgress(
      meta.id,
      ep.season,
      ep.episode,
      null,
      imdbKey,
      traktWatched,
      isNuvio ? nuvioWatched : stremioWatched,
      undefined,
      simklWatched,
      undefined,
      ep.imdbSeason,
      ep.imdbEpisode,
      pmdbWatched,
      ep.absoluteNumber,
    ).watched;
  };

  return { watchedFor };
}
