import { Bell, BellOff, Check, Download, LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Meta } from "@/lib/cinemeta";
import type { PlayEpisode, PlayerStreamRef } from "@/lib/view";
import type { ScoredStream } from "@/lib/streams/types";
import { useAuth } from "@/lib/auth";
import { useSettings } from "@/lib/settings";
import { useDebridClients } from "@/lib/debrid/registry";
import { useAddons } from "@/views/play-picker/use-addons";
import { useAnimeAltTitles } from "@/views/play-picker/use-anime-alt-titles";
import { useImdbId } from "@/views/play-picker/use-imdb-id";
import { useStreamIds } from "@/views/play-picker/use-stream-ids";
import { usePipelineResult } from "@/views/play-picker/use-pipeline-result";
import { resolveStream, shouldPreferP2pDownload } from "@/lib/streams/resolve";
import { isHostedTorrentServerUrl } from "@/lib/torrent/stremio-stream";
import { localEngineStreamRef } from "@/lib/torrent/local-engine";
import { isLocalUrl } from "@/lib/player/local-url";
import { readLastSeriesPlayback } from "@/lib/playback-history";
import {
  completedDownloadFor, downloadsSnapshot, enqueueDownload,
} from "@/lib/download/downloads-store";
import { sharedPlaybackTorrentRisk } from "./download-action";
import { useEpisodeDownload } from "./use-episode-download";
import { contextDownloadTask } from "@/lib/download/contextual-preparation";
import { isManuallyStoppedForAutoPreDownload } from "./pre-download-retry";
import {
  bestAvailablePreDownloadStream, downloadSourceRef,
  hasReusableEpisodeSource, matchingPreDownloadStream, preDownloadSourceForPlayback,
} from "./pre-download-source";
import { useT } from "@/lib/i18n";

type Phase = "idle" | "finding" | "preparing" | "queued" | "blocked" | "error";
export type PreDownloadToastKind = "enabled" | "disabled" | "downloading" | "completed" | "error";

function MatchNextEpisodeSource({
  meta, episode, source, onMatch, onUnavailable,
}: {
  meta: Meta;
  episode: PlayEpisode;
  source: PlayerStreamRef | null;
  onMatch: (stream: ScoredStream) => void;
  onUnavailable: () => void;
}) {
  const { authKey } = useAuth();
  const { settings } = useSettings();
  const debrids = useDebridClients();
  const { addons } = useAddons(authKey, settings);
  const resolvedImdb = useImdbId(meta, settings.tmdbKey);
  const streamIds = useStreamIds(meta, episode, resolvedImdb.id);
  const animeTitles = useAnimeAltTitles(meta, episode.sourceMetaId);
  const { result, pipelineDone } = usePipelineResult({
    meta, episode, imdbId: resolvedImdb.id, imdbIdVerified: resolvedImdb.verified,
    streamIds, addons, debrids, settings,
    strictMode: settings.streamFilterLevel === "strict",
    filterDisabled: settings.streamFilterLevel === "off",
    animeTitles, preferredAddonId: source?.addonId ?? null,
  });
  const selectedRef = useRef(false);
  useEffect(() => {
    if (!pipelineDone || selectedRef.current) return;
    selectedRef.current = true;
    const streams = result?.picker.all ?? [];
    const match = hasReusableEpisodeSource(source)
      ? matchingPreDownloadStream(streams, source, episode)
      : bestAvailablePreDownloadStream(streams, episode);
    if (match) onMatch(match);
    else onUnavailable();
  }, [pipelineDone, result, source, episode, onMatch, onUnavailable]);
  return null;
}

/** Remains mounted while the player episode drawer is collapsed. */
export function PreDownloadNextEpisode({
  meta, currentEpisode, episode, currentSource, currentStreamUrl, onToast,
}: {
  meta: Meta;
  currentEpisode: PlayEpisode | undefined;
  episode: PlayEpisode;
  currentSource: PlayerStreamRef | null | undefined;
  currentStreamUrl: string;
  onToast: (kind: PreDownloadToastKind, message: string) => void;
}) {
  const t = useT();
  const { settings, update } = useSettings();
  const enabled = settings.autoPreDownloadNextEpisode;
  const notificationsEnabled = settings.autoPreDownloadNotifications !== false;
  const enabledAt = settings.autoPreDownloadNextEpisodeEnabledAt ?? 0;
  const debrids = useDebridClients();
  const download = useEpisodeDownload(meta.id, episode.season, episode.episode);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const acRef = useRef<AbortController | null>(null);
  const requestRef = useRef(0);

  // A local file has no streaming identity. Prefer the source saved alongside
  // that download, then Harbor's last successfully chosen online release.
  const source = useMemo((): PlayerStreamRef | null => {
    const saved = downloadsSnapshot().find((d) =>
      d.status === "done" && d.metaId === meta.id &&
      d.season === currentEpisode?.season && d.episode === currentEpisode?.episode,
    );
    return preDownloadSourceForPlayback(
      currentStreamUrl, currentSource, saved, readLastSeriesPlayback(meta.id),
    );
  }, [currentStreamUrl, currentSource, currentEpisode?.season, currentEpisode?.episode, meta.id]);

  const downloaded = download?.status === "done";
  const active = download?.status === "downloading" || download?.status === "paused";
  const manuallyStopped = isManuallyStoppedForAutoPreDownload(download, enabledAt);
  const busy = phase === "finding" || phase === "preparing";
  const previousDownloadStatusRef = useRef(download?.status);
  useEffect(() => {
    const previous = previousDownloadStatusRef.current;
    previousDownloadStatusRef.current = download?.status;
    if (enabled && download?.status === "done" &&
        (previous === "downloading" || previous === "paused")) {
      onToast("completed", t("Next episode downloaded"));
    }
  }, [download?.status, enabled, onToast, t]);
  const episodeLabel = `S${episode.imdbSeason ?? episode.season} · E${String(episode.imdbEpisode ?? episode.episode).padStart(2, "0")}`;

  useEffect(() => () => {
    requestRef.current++;
    acRef.current?.abort();
  }, []);

  // A manual cancel blocks this episode for the current switch-on interval.
  // A different episode gets a new panel instance and can download normally.
  useEffect(() => {
    if (!enabled) {
      if (phase !== "idle") {
        requestRef.current++;
        acRef.current?.abort();
        acRef.current = null;
        setError(null);
        setPhase("idle");
      }
      return;
    }
    if (manuallyStopped) {
      if (phase !== "blocked") {
        requestRef.current++;
        acRef.current?.abort();
        acRef.current = null;
        setPhase("blocked");
      }
      return;
    }
    if (phase === "blocked") {
      setPhase("idle");
      return;
    }
    if (downloaded || active || phase !== "idle") return;
    requestRef.current++;
    setError(null);
    setPhase("finding");
  }, [enabled, downloaded, active, manuallyStopped, phase]);

  useEffect(() => {
    if (phase !== "finding") return;
    const timeout = window.setTimeout(() => {
      requestRef.current++;
      setPhase("error");
      setError(t("Could not find a source for the next episode."));
      onToast("error", t("Next episode: no matching source found"));
    }, 45_000);
    return () => window.clearTimeout(timeout);
  }, [phase, onToast, t]);

  const fail = useCallback((message: string) => {
    setError(message);
    setPhase("error");
    onToast("error", message);
  }, [onToast]);

  const onUnavailable = useCallback(() => {
    fail(hasReusableEpisodeSource(source)
      ? t("No matching release found for the next episode.")
      : t("No downloadable next-episode source is available."));
  }, [fail, source, t]);

  const stoppedNow = useCallback(() => isManuallyStoppedForAutoPreDownload(
    contextDownloadTask(downloadsSnapshot(), meta.id, episode), enabledAt,
  ), [meta.id, episode.season, episode.episode, enabledAt]);

  const onMatch = useCallback(async (stream: ScoredStream) => {
    const request = requestRef.current;
    if (stoppedNow()) { setPhase("blocked"); return; }
    const existing = downloadsSnapshot().some((d) =>
      d.metaId === meta.id && d.season === episode.season && d.episode === episode.episode &&
      (d.status === "done" || d.status === "downloading" || d.status === "paused"),
    );
    if (existing) { setPhase("queued"); return; }
    if (!stream.url && stream.externalUrl) {
      fail(t("The next-episode source is not downloadable."));
      return;
    }
    const activeTorrent = localEngineStreamRef(currentStreamUrl);
    const usesTorrentEngine = shouldPreferP2pDownload(stream) ||
      !stream.url || isHostedTorrentServerUrl(stream.url);
    if (sharedPlaybackTorrentRisk(activeTorrent?.infoHash ?? null, stream.infoHash, usesTorrentEngine)) {
      fail(t("Pre-download skipped to protect the currently playing torrent."));
      return;
    }
    const ac = new AbortController();
    acRef.current?.abort();
    acRef.current = ac;
    setPhase("preparing");
    try {
      const resolved = await resolveStream(
        stream, debrids, ac.signal, true, shouldPreferP2pDownload(stream),
        { season: episode.season, episode: episode.episode }, true, false,
      );
      if (ac.signal.aborted || request !== requestRef.current) return;
      if (!resolved.ok) {
        fail(t("Could not prepare the next-episode download."));
        return;
      }
      const current = downloadsSnapshot().some((d) =>
        d.metaId === meta.id && d.season === episode.season && d.episode === episode.episode &&
        (d.status === "done" || d.status === "downloading" || d.status === "paused"),
      );
      if (current) { setPhase("queued"); return; }
      if (stoppedNow()) { setPhase("blocked"); return; }
      const completed = await completedDownloadFor(meta.id, episode.season, episode.episode);
      if (ac.signal.aborted || request !== requestRef.current) return;
      if (completed) { setPhase("queued"); return; }
      if (stoppedNow()) { setPhase("blocked"); return; }
      const streamLabel = [stream.resolution, stream.source].filter(Boolean).join(" ") ||
        stream.parsedTitle || stream.title || stream.name || stream.addonName || null;
      await enqueueDownload({
        meta, episode, streamLabel, url: resolved.data.url,
        headers: resolved.data.headers, sourceRef: downloadSourceRef(stream),
      });
      if (!ac.signal.aborted && request === requestRef.current) {
        setPhase("queued");
        onToast("downloading", t("Pre-downloading {episode}", { episode: episodeLabel }));
      }
    } catch {
      if (!ac.signal.aborted && request === requestRef.current)
        fail(t("Could not start the next-episode download."));
    } finally {
      if (acRef.current === ac) acRef.current = null;
    }
  }, [currentStreamUrl, debrids, episode, episodeLabel, fail, meta, onToast, stoppedNow, t]);

  const toggle = () => {
    if (enabled) {
      update({ autoPreDownloadNextEpisode: false });
    } else {
      update({
        autoPreDownloadNextEpisode: true,
        autoPreDownloadNextEpisodeEnabledAt: Math.max(Date.now(), enabledAt + 1),
      });
    }
    onToast(enabled ? "disabled" : "enabled", enabled
      ? t("Automatic next-episode downloads turned off")
      : t("Automatic next-episode downloads turned on"));
  };

  return (
    <div className="mx-1 mb-4 border-b border-edge-soft/60 px-1 pb-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[12px] font-semibold text-ink" title={t("Auto pre-download next episode")}>{t("Auto pre-download next episode")}</p>
          <p className="mt-0.5 truncate text-[11px] text-ink-subtle">
            {episodeLabel} · {downloaded ? t("Saved offline") :
              active ? t("Downloading") :
              phase === "finding" ? t("Matching source") :
              phase === "preparing" ? t("Preparing download") :
              phase === "error" && enabled ? t("No matching source") :
              phase === "blocked" && enabled ? t("Manually stopped for this episode") :
              isLocalUrl(currentStreamUrl) && hasReusableEpisodeSource(source)
                ? t("Using remembered online source")
                : !source ? t("Select best available source automatically")
                : t("Use same release as current playback")}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {enabled && (
            <button
              type="button"
              role="switch"
              aria-checked={notificationsEnabled}
              aria-label={t("Pre-download notifications")}
              title={notificationsEnabled ? t("Turn off pre-download notifications") : t("Turn on pre-download notifications")}
              onClick={() => update({ autoPreDownloadNotifications: !notificationsEnabled })}
              className={`flex h-7 w-7 items-center justify-center rounded-full ring-1 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${notificationsEnabled
                ? "bg-accent/10 text-accent ring-accent/35 hover:bg-accent/20"
                : "bg-elevated text-ink-muted ring-edge-soft hover:bg-raised"}`}
            >
              {notificationsEnabled ? <Bell size={15} aria-hidden="true" /> : <BellOff size={15} aria-hidden="true" />}
            </button>
          )}
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-label={t("Auto pre-download next episode")}
            onClick={toggle}
            className={`relative h-7 w-12 shrink-0 rounded-full ring-1 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${enabled
              ? "bg-accent ring-accent/60" : "bg-elevated ring-edge-soft"}`}
          >
            <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow-sm transition-[left,right,transform] ${enabled ? "left-[25px]" : "left-1"}`} />
          </button>
        </div>
      </div>
      {enabled && (busy || active || downloaded || phase === "error" || phase === "blocked") && (
        <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-ink-subtle" role="status">
          {busy ? <LoaderCircle size={12} className="animate-spin" /> :
            downloaded ? <Check size={12} /> :
            active ? <Download size={12} /> : null}
          <span className="truncate">
            {phase === "error" ? error : phase === "blocked" ? t("Toggle off and on to retry") : downloaded ? t("Download completed") :
              active ? t("Download queued · {pct}%", {
                pct: Math.round(Math.min(1, Math.max(0, download?.ratio ?? 0)) * 100),
              }) : phase === "finding" ? t("Searching in the background") :
                t("Preparing in the background")}
          </span>
        </div>
      )}
      {enabled && phase === "finding" && (
        <MatchNextEpisodeSource
          meta={meta} episode={episode} source={source}
          onMatch={onMatch} onUnavailable={onUnavailable}
        />
      )}
    </div>
  );
}
