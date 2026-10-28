import { useEffect, useMemo, useRef } from "react";
import { useAuth } from "@/lib/auth";
import type { Meta } from "@/lib/cinemeta";
import { useDebridClients } from "@/lib/debrid/registry";
import { completedDownloadFor } from "@/lib/download/downloads-store";
import { getPlaybackPosition } from "@/lib/player/playback-clock";
import { useSettings } from "@/lib/settings";
import { fetchAddonStreams } from "@/lib/streams/addons";
import { buildEpisodePipelineInput } from "@/lib/streams/episode-pipeline-input";
import { isPluginAddon } from "@/lib/streams/plugins";
import type { PlayEpisode } from "@/lib/view";
import { useAddons } from "@/views/play-picker/use-addons";
import { useAnimeAltTitles } from "@/views/play-picker/use-anime-alt-titles";
import { useStreamIds } from "@/views/play-picker/use-stream-ids";

const PREFETCH_WINDOW_SEC = 120;
const PREFETCH_TICK_MS = 30_000;

/**
 * Warm the next episode's streams from the addon that is playing right now.
 *
 * Auto-play only waits for the remembered source once the next picker opens, and
 * a slow aggregator such as AIOStreams can take most of a 30s request budget.
 * Recheck near the end so pauses and backward seeks cannot leave an expired
 * answer. The foreground picker can consume the answer or adopt the request.
 */
export function NextEpisodePrefetch({
  meta,
  nextEpisode,
  imdbId,
  imdbVerified,
  addonId,
  durationSec,
}: {
  meta: Meta;
  nextEpisode: PlayEpisode;
  imdbId: string | null;
  imdbVerified: boolean;
  addonId: string;
  durationSec: number;
}) {
  const { settings } = useSettings();
  const { authKey } = useAuth();
  const debrids = useDebridClients();
  const { addons: installed } = useAddons(authKey, settings);
  const addons = useMemo(
    () =>
      installed ? installed.filter((a) => settings.pluginsBackground || !isPluginAddon(a)) : null,
    [installed, settings.pluginsBackground],
  );
  const streamIds = useStreamIds(meta, nextEpisode, imdbId);
  const animeTitles = useAnimeAltTitles(meta);
  const durationRef = useRef(durationSec);
  durationRef.current = durationSec;

  const strictMode = settings.streamFilterLevel === "strict";
  const filterDisabled = settings.streamFilterLevel === "off";

  useEffect(() => {
    if (!streamIds || addons === null) return;
    let controller: AbortController | null = null;
    let disposed = false;

    const maybeStart = () => {
      if (disposed || controller) return;
      const duration = durationRef.current;
      // Wait for a real duration, then start once the end is close enough that
      // the answer is still fresh when the next episode actually begins.
      if (!Number.isFinite(duration) || duration <= 0) return;
      if (duration - getPlaybackPosition() > PREFETCH_WINDOW_SEC) return;
      const ac = new AbortController();
      controller = ac;
      void (async () => {
        const downloading = !!(await completedDownloadFor(
          meta.id,
          nextEpisode.season,
          nextEpisode.episode,
        ).catch(() => null));
        if (downloading || ac.signal.aborted) return;
        const input = buildEpisodePipelineInput({
          meta,
          episode: nextEpisode,
          imdbId,
          imdbIdVerified: imdbVerified,
          streamIds,
          addons,
          debrids,
          settings,
          strictMode,
          filterDisabled,
          animeTitles,
          resolvePinnedPlugin: settings.pluginsBackground,
        });
        const addon = input.addons.find((a) => a.manifest.id === addonId);
        if (!addon) return;
        await fetchAddonStreams(
          [addon],
          input.request,
          ac.signal,
          undefined,
          undefined,
          input.addonTimeoutMs,
          input.addonRanks,
          input.forcedAddonBases,
          true,
        ).catch(() => {});
      })()
        .catch(() => {})
        .finally(() => {
          controller = null;
        });
    };

    maybeStart();
    const timer = window.setInterval(maybeStart, PREFETCH_TICK_MS);
    return () => {
      window.clearInterval(timer);
      disposed = true;
      controller?.abort();
    };
  }, [
    meta,
    nextEpisode,
    imdbId,
    imdbVerified,
    addonId,
    streamIds,
    addons,
    debrids,
    settings,
    strictMode,
    filterDisabled,
    animeTitles,
  ]);

  return null;
}
