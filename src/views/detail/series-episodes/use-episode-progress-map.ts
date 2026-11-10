import { useEffect, useMemo, useState } from "react";
import { getEpisodeProgress, createEpisodeProgressSnapshot } from "@/lib/episode-progress";
import { episodeSpoilerMasks, spoilerMaskFor, type SpoilerMask } from "@/lib/spoilers";
import type { Episode } from "@/lib/providers/tmdb";
import { airedOnly } from "../helpers";

export function useEpisodeProgressMap({
  episodes,
  metaId,
  traktKey,
  traktWatched,
  stremioWatched,
  simklWatched,
  pmdbWatched,
  mwVersion,
  settings,
}: {
  episodes: Episode[];
  metaId: string;
  traktKey: string;
  traktWatched: Set<string>;
  stremioWatched?: Set<string>;
  simklWatched?: Set<string>;
  pmdbWatched?: Set<string>;
  mwVersion: number;
  settings: Parameters<typeof spoilerMaskFor>[0];
}) {
  const [updateVersion, setUpdateVersion] = useState(0);

  useEffect(() => {
    const bump = () => setUpdateVersion((v) => v + 1);
    window.addEventListener("harbor:continue-watching-updated", bump);
    window.addEventListener("harbor:watched-changed", bump);
    window.addEventListener("harbor:series-watched-changed", bump);
    window.addEventListener("harbor:nuvio-progress-pushed", bump);
    window.addEventListener("harbor:playback-ended", bump);
    window.addEventListener("focus", bump);
    return () => {
      window.removeEventListener("harbor:continue-watching-updated", bump);
      window.removeEventListener("harbor:watched-changed", bump);
      window.removeEventListener("harbor:series-watched-changed", bump);
      window.removeEventListener("harbor:nuvio-progress-pushed", bump);
      window.removeEventListener("harbor:playback-ended", bump);
      window.removeEventListener("focus", bump);
    };
  }, []);

  const progressByEp = useMemo(() => {
    const local = createEpisodeProgressSnapshot();
    const m = new Map<number, ReturnType<typeof getEpisodeProgress>>();
    for (const ep of episodes) {
      m.set(
        ep.episodeNumber,
        getEpisodeProgress(
          metaId,
          ep.seasonNumber,
          ep.episodeNumber,
          ep.runtime,
          traktKey,
          traktWatched,
          stremioWatched,
          undefined,
          simklWatched,
          undefined,
          undefined,
          undefined,
          pmdbWatched,
          undefined,
          local,
        ),
      );
    }
    return m;
  }, [
    episodes,
    metaId,
    traktKey,
    traktWatched,
    stremioWatched,
    simklWatched,
    pmdbWatched,
    mwVersion,
    updateVersion,
  ]);

  const nextUpEp = useMemo(() => {
    for (const ep of episodes) {
      if (!progressByEp.get(ep.episodeNumber)?.watched) return ep.episodeNumber;
    }
    return null;
  }, [episodes, progressByEp]);

  const masks = episodeSpoilerMasks(
    settings,
    episodes.map((ep) => ep.episodeNumber),
    (epNumber) => progressByEp.get(epNumber)?.watched ?? false,
  );
  const spoilerFor = (epNumber: number): SpoilerMask =>
    masks.get(epNumber) ?? spoilerMaskFor(settings, { watched: false, isNextUp: false });

  const airedEps = airedOnly(episodes, (ep) => ep.airDate);
  const allWatched =
    airedEps.length > 0 && airedEps.every((ep) => progressByEp.get(ep.episodeNumber)?.watched);

  return { progressByEp, nextUpEp, spoilerFor, allWatched };
}
