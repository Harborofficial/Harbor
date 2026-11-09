import { AlertCircle, CheckCheck, ChevronDown, ChevronLeft, ChevronRight, Download, ToggleLeft, ToggleRight, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { HarborLoader } from "@/components/harbor-loader";
import type { Meta } from "@/lib/cinemeta";
import { useDebridClients } from "@/lib/debrid/registry";
import { invalidatePreparedDebridLink } from "@/lib/debrid/playback-preparation";
import type { PanelCorner } from "@/lib/player-chrome";
import { useSettings } from "@/lib/settings";
import { spoilerMaskFor } from "@/lib/spoilers";
import { registerStreamProxy } from "@/lib/stream-proxy";
import { unregisterStreamProxy } from "@/lib/stream-proxy";
import { preflightCheck } from "@/lib/streams/preflight";
import { resolveStream, shouldPreferP2pDownload } from "@/lib/streams/resolve";
import { isHostedTorrentServerUrl } from "@/lib/torrent/stremio-stream";
import { localEngineStreamRef } from "@/lib/torrent/local-engine";
import {
  beginPlaybackTrace,
  finishPlaybackTrace,
  markPlaybackTrace,
} from "@/lib/perf/playback-trace";
import type { ScoredStream } from "@/lib/streams/types";
import { cancelDownload, downloadsSnapshot, enqueueDownload } from "@/lib/download/downloads-store";
import { contextDownloadTask } from "@/lib/download/contextual-preparation";
import { completedEpisodeSource } from "@/lib/download/completed-episode-source";
import { savePlayback } from "@/lib/playback-history";
import { usePlayerNavigation, type PlayEpisode, type PlayerStreamRef } from "@/lib/view";
import { parseKitsuId } from "@/lib/providers/kitsu";
import { splitFranchiseDisplaySeason } from "@/lib/streams/anime-identity-core";
import { queueItemAfter, useQueue } from "@/lib/queue";
import { isNextAired } from "@/lib/cw-resurface";
import { QueueUpNext } from "./queue-up-next";
import { episodePanelQueueMode } from "./queue-mode";
import { episodeDownloadAction, sharedPlaybackTorrentRisk } from "./download-action";
import { playLocalAware } from "@/lib/local-library/playback";
import { localPlayerSrc } from "@/lib/local-library/player-src";
import { useT } from "@/lib/i18n";
import { EpisodeRow } from "./episode-row";
import { SeasonPicker } from "./season-picker";
import { EntryPicker } from "./entry-picker";
import { StreamsView } from "./streams-view";
import { useSeasonBrowser } from "./use-season-browser";
import { useAnimeEntryBrowser } from "./use-anime-entries";
import { PreDownloadNextEpisode, type PreDownloadToastKind } from "./pre-download-next";
import "./pre-download-toast.css";
import { dismissPreDownloadToast, enqueuePreDownloadToast, preDownloadToastDurationMs, visiblePreDownloadToast } from "./pre-download-toast-queue";
import { downloadSourceRef } from "./pre-download-source";

const RESOLVE_TIMEOUT_MS = 150_000;

function displayEpLabel(ep: PlayEpisode, metaId?: string): string {
  const part =
    splitFranchiseDisplaySeason(parseKitsuId(ep.kitsuStreamId ?? "")) ??
    splitFranchiseDisplaySeason(parseKitsuId(metaId ?? ""));
  if (part != null) return `S${part} · E${String(ep.episode).padStart(2, "0")}`;
  return `S${ep.imdbSeason ?? ep.season} · E${String(ep.imdbEpisode ?? ep.episode).padStart(2, "0")}`;
}

function sameEpisode(a: PlayEpisode, b: PlayEpisode): boolean {
  if (a.kitsuStreamId && b.kitsuStreamId) return a.kitsuStreamId === b.kitsuStreamId;
  return (
    (a.imdbSeason ?? a.season) === (b.imdbSeason ?? b.season) &&
    (a.imdbEpisode ?? a.episode) === (b.imdbEpisode ?? b.episode)
  );
}

export function EpisodePanel({
  open,
  onClose,
  meta,
  queueSessionAvailable,
  queuePlaybackEnabled,
  currentEpisode,
  currentStreamUrl,
  currentStreamRef,
  currentImdbId,
  currentIsAnime,
  corner = "top-right",
  roomGuest = false,
  inRoom = false,
  onHostAdvance,
  watchedFor,
  nextEp,
  onRestart,
}: {
  engine: "html5" | "mpv";
  open: boolean;
  onClose: () => void;
  meta: Meta;
  queueSessionAvailable: boolean;
  queuePlaybackEnabled: boolean;
  currentEpisode: PlayEpisode | undefined;
  currentStreamUrl?: string;
  currentStreamRef?: PlayerStreamRef | null;
  currentImdbId?: string;
  currentIsAnime?: boolean;
  corner?: PanelCorner;
  roomGuest?: boolean;
  inRoom?: boolean;
  onHostAdvance?: (ep: PlayEpisode) => void;
  watchedFor?: (
    ep: PlayEpisode,
    entryId?: string,
    entryImdbId?: string | null,
    allowAlias?: boolean,
  ) => boolean;
  nextEp?: PlayEpisode | null;
  onRestart?: () => void;
}) {
  const t = useT();
  const { settings, update } = useSettings();
  const { openPicker, replacePlayerSrc } = usePlayerNavigation();
  const queue = useQueue();
  const debrids = useDebridClients();
  const entryBrowser = useAnimeEntryBrowser(meta, currentEpisode, open);
  const { seasons, season, setSeason, episodes, loading, imdbRatings } = useSeasonBrowser(
    meta,
    currentEpisode,
    open,
    entryBrowser.browsing ? entryBrowser.activeMeta : null,
  );
  const playbackMeta = entryBrowser.activeMeta ?? meta;
  const nextSeason = seasons.find((n) => n > season);
  const prevSeason = [...seasons].reverse().find((n) => n < season);
  const seasonLabel = (n: number) => (n === 0 ? t("Specials") : t("Season {n}", { n }));
  const entryLabel = (entry: { id: string; meta: Meta }) => {
    const part = splitFranchiseDisplaySeason(parseKitsuId(entry.id));
    return part != null ? seasonLabel(part) : entry.meta.name;
  };
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current?.scrollTo({ top: 0 });
  }, [season]);
  const [expandedEp, setExpandedEp] = useState<string | null>(null);
  const [pickingFor, setPickingFor] = useState<PlayEpisode | null>(null);
  const [downloadFor, setDownloadFor] = useState<PlayEpisode | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloadNotice, setDownloadNotice] = useState<string | null>(null);
  const notificationsEnabled = settings.autoPreDownloadNotifications !== false;
  const [toastQueue, setToastQueue] = useState<Array<{
    id: number;
    kind: PreDownloadToastKind;
    label: string;
  }>>([]);
  const toastSequenceRef = useRef(0);
  const showPreDownloadToast = useCallback((kind: PreDownloadToastKind, label: string) => {
    if (!notificationsEnabled) return;
    const next = { id: ++toastSequenceRef.current, kind, label };
    setToastQueue((queue) => enqueuePreDownloadToast(queue, next));
  }, [notificationsEnabled]);
  useEffect(() => {
    if (!notificationsEnabled) setToastQueue((queue) => queue.length ? [] : queue);
  }, [notificationsEnabled]);
  const preDownloadToast = visiblePreDownloadToast(toastQueue, notificationsEnabled);
  useEffect(() => {
    if (!preDownloadToast) return;
    const timer = window.setTimeout(() => {
      setToastQueue((queue) => dismissPreDownloadToast(queue, preDownloadToast.id));
    }, preDownloadToastDurationMs(preDownloadToast.kind));
    return () => window.clearTimeout(timer);
  }, [preDownloadToast?.id]);
  const [resolvingFor, setResolvingFor] = useState<PlayEpisode | null>(null);
  const [resolvingIntent, setResolvingIntent] = useState<"play" | "download" | null>(null);
  const resolveAcRef = useRef<AbortController | null>(null);
  const manualPlayRevisionRef = useRef(0);
  const panelOpenRef = useRef(open);
  panelOpenRef.current = open;
  const activePlaybackKey = `${meta.id}|${currentStreamUrl ?? ""}|${currentEpisode?.season ?? ""}:${currentEpisode?.episode ?? ""}`;
  const activePlaybackKeyRef = useRef(activePlaybackKey);
  activePlaybackKeyRef.current = activePlaybackKey;
  useEffect(() => () => { manualPlayRevisionRef.current += 1; }, []);
  useEffect(() => {
    if (!resolvingFor) return;
    const timeout = window.setTimeout(() => {
      resolveAcRef.current?.abort();
      if (resolvingIntent === "download") setDownloadError(t("Download preparation timed out. Choose another source."));
      setResolvingFor(null);
      setResolvingIntent(null);
    }, RESOLVE_TIMEOUT_MS);
    return () => window.clearTimeout(timeout);
  }, [resolvingFor, resolvingIntent]);
  useEffect(() => () => resolveAcRef.current?.abort(), []);
  const [showEpsOpen, setShowEpsOpen] = useState(false);
  const hasQueue = queue.length > 0;
  const isSeries = meta.type === "series";
  const { followQueue, canChooseQueue } = episodePanelQueueMode({
    isSeries,
    queueSessionAvailable,
    queuePlaybackEnabled,
  });
  const showQueueList = hasQueue && (followQueue || !isSeries);
  const queuedNext = followQueue && currentEpisode ? queueItemAfter(meta, currentEpisode) : null;
  const preDownloadEpisode = followQueue
    ? queuedNext?.meta.id === meta.id ? queuedNext?.episode ?? null : null
    : nextEp ?? null;
  const preDownloadIsAired = !!preDownloadEpisode && isNextAired(false, preDownloadEpisode.airDate);
  const preDownloadKey = `${meta.id}:${preDownloadEpisode?.season ?? ""}:${preDownloadEpisode?.episode ?? ""}:${currentStreamUrl ?? ""}:${currentStreamRef?.addonId ?? ""}:${currentStreamRef?.infoHash ?? ""}:${currentStreamRef?.releaseGroup ?? ""}`;
  useEffect(() => {
    if (!open) {
      manualPlayRevisionRef.current += 1;
      setExpandedEp(null);
      setPickingFor(null);
      setDownloadFor(null);
      setDownloadError(null);
      setDownloadNotice(null);
      resolveAcRef.current?.abort();
      setResolvingFor(null);
      setResolvingIntent(null);
    }
  }, [open]);
  const manualMode = !settings.instantPlay;
  const handlePlay = (ep: PlayEpisode, restartCurrent = false) => {
    if (roomGuest) return;
    const request = ++manualPlayRevisionRef.current;
    const initialPlaybackKey = activePlaybackKeyRef.current;
    const stillCurrent = () => manualPlayRevisionRef.current === request && panelOpenRef.current &&
      activePlaybackKeyRef.current === initialPlaybackKey;
    const playNormally = () => {
      if (!stillCurrent()) return;
      if (restartCurrent) {
        onRestart?.();
        onClose();
        return;
      }
      const streamFlow = () => {
        if (manualMode) {
          setPickingFor(ep);
        } else {
          onClose();
          openPicker(playbackMeta, ep, { autoPlay: true });
        }
      };
      playLocalAware({
        meta,
        episode: ep,
        mode: settings.localPlaybackMode,
        source: "manual",
        playLocal: (e, o) => {
          onClose();
          replacePlayerSrc({ ...localPlayerSrc(e, currentIsAnime, ep), startFromZero: o?.fromStart });
        },
        playStream: streamFlow,
        setMode: (m) => update({ localPlaybackMode: m }),
      });
    };
    // Only pay for a file-existence check when an episode has a completed download.
    const hasFinishedDownload = downloadsSnapshot().some((d) =>
      d.status === "done" && d.metaId === playbackMeta.id && d.season === ep.season && d.episode === ep.episode,
    );
    // Private local files must not be substituted for a Watch Together stream.
    if (inRoom || !hasFinishedDownload) {
      playNormally();
      return;
    }
    void completedEpisodeSource(playbackMeta, ep, {
      imdbId: currentImdbId ?? ep.imdbId,
      isAnime: currentIsAnime,
      startFromZero: restartCurrent,
    }).then((download) => {
      if (!stillCurrent()) return;
      if (!download) {
        playNormally();
        return;
      }
      onClose();
      replacePlayerSrc(download);
    }, playNormally);
  };
  const handlePickStream = async (stream: ScoredStream) => {
    if (!pickingFor || roomGuest) return;
    if (!stream.url && stream.externalUrl) return;
    const ep = pickingFor;
    const playbackTraceId = beginPlaybackTrace(
      stream.url ? "direct" : debrids.length > 0 ? "debrid" : "p2p",
    );
    let traceTransferred = false;
    let proxySessionId: string | undefined;
    let proxyTransferred = false;
    markPlaybackTrace(playbackTraceId, "resolve-start");
    resolveAcRef.current?.abort();
    const ac = new AbortController();
    resolveAcRef.current = ac;
    setResolvingFor(ep);
    setResolvingIntent("play");
    try {
      const hint = { season: ep.season ?? null, episode: ep.episode ?? null };
      const r = await resolveStream(stream, debrids, ac.signal, true, false, hint);
      if (ac.signal.aborted) return;
      if (!r.ok) {
        setResolvingFor(null);
        return;
      }
      markPlaybackTrace(playbackTraceId, "resolve-ready");
      let playUrl = r.data.url;
      const hasProxyHeaders = !!r.data.headers && Object.keys(r.data.headers).length > 0;
      if (hasProxyHeaders) {
        try {
          const proxied = await registerStreamProxy(r.data.url, r.data.headers);
          playUrl = proxied.url;
          proxySessionId = proxied.sessionId;
        } catch {
          setResolvingFor(null);
          return;
        }
      }
      const skipPreflight =
        r.via === "p2p" ||
        r.via === "direct" ||
        r.via === "local-download" ||
        r.readiness?.exactUrlValidated === true;
      if (!skipPreflight) markPlaybackTrace(playbackTraceId, "preflight-start");
      const preflight = skipPreflight
        ? ({ ok: true } as const)
        : await preflightCheck(playUrl).catch(() => ({ ok: true }) as const);
      if (!skipPreflight) markPlaybackTrace(playbackTraceId, "preflight-ready");
      if (!preflight.ok && preflight.reason === "stub") {
        const preparedDebrid = debrids.find((debrid) => debrid.slug === r.via);
        if (preparedDebrid) invalidatePreparedDebridLink(stream, preparedDebrid, hint);
        setResolvingFor(null);
        return;
      }
      onHostAdvance?.(ep);
      const streamRef = {
        resolvedFilename: r.data.filename ?? stream.behaviorHints?.filename ?? stream.behaviorHints?.fileName ?? null,
        infoHash: stream.infoHash ?? null,
        fileIdx: r.data.fileIdx ?? stream.fileIdx ?? null,
        addonId: stream.addonId ?? null,
        title: stream.title ?? null,
        parsedTitle: stream.parsedTitle ?? null,
        resolution: stream.resolution ?? null,
        releaseGroup: stream.releaseGroupNormalized ?? null,
        source: stream.source ?? null,
        audioLanguages: stream.audioLanguages ?? null,
        bingeGroup: stream.behaviorHints?.bingeGroup ?? null,
        size: stream.size ?? null,
        cachedSlugs: Object.entries(stream.cached ?? {}).filter(([, v]) => v === true).map(([k]) => k),
      };
      replacePlayerSrc({
        meta: playbackMeta,
        episode: ep,
        url: playUrl,
        title: stream.parsedTitle ?? stream.title ?? stream.name ?? playbackMeta.name,
        notWebReady: !stream.url && !!stream.infoHash,
        playbackTraceId,
        proxySessionId,
        historyUrl: r.data.url,
        subtitles: [],
        streamRef,
      });
      // Record the exact release immediately so an intervening offline episode
      // cannot obscure the previous online source before the next auto-advance.
      savePlayback(playbackMeta.id, { ...streamRef, url: r.data.url, title: playbackMeta.name }, ep.season, ep.episode);
      markPlaybackTrace(playbackTraceId, "player-opened");
      traceTransferred = true;
      proxyTransferred = true;
      onClose();
    } catch {
      setResolvingFor(null);
    } finally {
      if (proxySessionId && !proxyTransferred) {
        void unregisterStreamProxy(proxySessionId).catch(() => {});
      }
      if (!traceTransferred) finishPlaybackTrace(playbackTraceId, "failed");
    }
  };
  const beginEpisodeDownload = (ep: PlayEpisode) => {
    manualPlayRevisionRef.current += 1;
    const existing = contextDownloadTask(downloadsSnapshot(), playbackMeta.id, ep);
    const action = episodeDownloadAction(existing?.status);
    if (action === "saved") return;
    if (action === "cancel" && existing) {
      cancelDownload(existing.id);
      return;
    }
    setPickingFor(null);
    setDownloadFor(ep);
    setDownloadError(null);
    setDownloadNotice(null);
  };
  const handleDownloadStream = async (stream: ScoredStream) => {
    const ep = downloadFor;
    if (!ep || resolvingFor) return;
    if (!stream.url && stream.externalUrl) {
      setDownloadError(t("This source opens a website and cannot be downloaded. Choose another source."));
      return;
    }
    const activeTorrent = localEngineStreamRef(currentStreamUrl ?? "");
    const usesTorrentEngine = shouldPreferP2pDownload(stream) || !stream.url || isHostedTorrentServerUrl(stream.url);
    if (sharedPlaybackTorrentRisk(activeTorrent?.infoHash ?? null, stream.infoHash, usesTorrentEngine)) {
      setDownloadError(t("This torrent is already playing. Choose another source to avoid interrupting playback."));
      return;
    }
    const existing = contextDownloadTask(downloadsSnapshot(), playbackMeta.id, ep);
    if (episodeDownloadAction(existing?.status) !== "choose") {
      setDownloadFor(null);
      return;
    }
    const ac = new AbortController();
    resolveAcRef.current?.abort();
    resolveAcRef.current = ac;
    setResolvingFor(ep);
    setResolvingIntent("download");
    setDownloadError(null);
    try {
      const result = await resolveStream(
        stream, debrids, ac.signal, true, shouldPreferP2pDownload(stream),
        { season: ep.season, episode: ep.episode }, true, false,
      );
      if (ac.signal.aborted) return;
      if (!result.ok) {
        setDownloadError(t("Couldn't prepare this download. Try another source."));
        return;
      }
      // Another source may have been queued while this one was resolving.
      const current = contextDownloadTask(downloadsSnapshot(), playbackMeta.id, ep);
      if (episodeDownloadAction(current?.status) !== "choose") {
        setDownloadFor(null);
        return;
      }
      const label = [stream.resolution, stream.source].filter(Boolean).join(" ") ||
        stream.parsedTitle || stream.title || stream.name || stream.addonName || null;
      await enqueueDownload({ meta: playbackMeta, episode: ep, streamLabel: label, url: result.data.url, headers: result.data.headers, sourceRef: downloadSourceRef(stream) });
      if (!ac.signal.aborted) {
        setDownloadNotice(`${t("Added to downloads")} · ${displayEpLabel(ep, playbackMeta.id)}`);
        setDownloadFor(null);
      }
    } catch {
      if (!ac.signal.aborted) setDownloadError(t("Couldn't start this download. Try another source."));
    } finally {
      if (resolveAcRef.current === ac) {
        resolveAcRef.current = null;
        setResolvingFor(null);
        setResolvingIntent(null);
      }
    }
  };
  const prevEntry = entryBrowser.prevEntry;
  const nextEntry = entryBrowser.nextEntry;
  // While a browsed entry loads, its season list may still be the previous
  // entry's; the franchise neighbours are safe to show in the meantime.
  const numericPrev = loading ? undefined : prevSeason;
  const numericNext = loading ? undefined : nextSeason;
  const prevJump = numericPrev !== undefined
    ? { label: seasonLabel(numericPrev), go: () => setSeason(numericPrev) }
    : prevEntry
      ? { label: entryLabel(prevEntry), go: () => entryBrowser.browse(prevEntry.id) }
      : null;
  const nextJump = numericNext !== undefined
    ? { label: seasonLabel(numericNext), go: () => setSeason(numericNext) }
    : nextEntry
      ? { label: entryLabel(nextEntry), go: () => entryBrowser.browse(nextEntry.id) }
      : null;
  return (
    <>
    <div
      aria-hidden={!open}
      className={`pointer-events-${open ? "auto" : "none"} absolute inset-0 z-30`}
    >
      {resolvingFor && (
        <div className="pointer-events-auto absolute inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-black/82 backdrop-blur-md animate-in fade-in duration-150">
          <HarborLoader size="md" caption={t(resolvingIntent === "download" ? "Preparing download" : "Connecting")} />
          <p className="text-[13px] text-white/75">
            {t("Loading {label}", {
              label: `${displayEpLabel(resolvingFor, playbackMeta.id)}${
                resolvingFor.name ? ` · ${resolvingFor.name}` : ""
              }`,
            })}
          </p>
          <button
            onClick={() => {
              resolveAcRef.current?.abort();
              setResolvingFor(null);
              setResolvingIntent(null);
            }}
            className="mt-1 rounded-lg border border-white/20 bg-white/10 px-4 py-2 text-[13px] font-semibold text-white transition-colors duration-150 ease-in-out hover:bg-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/60"
          >
            {t("Cancel")}
          </button>
        </div>
      )}
      <button
        aria-label={t("Dismiss episode panel")}
        onClick={onClose}
        tabIndex={open ? 0 : -1}
        className={`absolute inset-0 cursor-default bg-black/35 transition-opacity duration-300 ${
          open ? "opacity-100" : "opacity-0"
        }`}
      />
      <aside
        role="dialog"
        aria-label={t("Up next")}
        className={`absolute top-0 h-full w-full max-w-[440px] overflow-hidden shadow-[0_30px_80px_-30px_rgba(0,0,0,0.85)] transition-transform duration-300 ease-out ${
          corner === "top-left" || corner === "bottom-left"
            ? "left-0 rounded-r-[12px]"
            : "right-0 rounded-l-[12px]"
        } ${
          open
            ? "translate-x-0"
            : corner === "top-left" || corner === "bottom-left"
              ? "-translate-x-full"
              : "translate-x-full"
        }`}
      >
        <div className="relative flex h-full w-full flex-col overflow-hidden bg-canvas">
          {downloadFor ? (
            <StreamsView
              meta={playbackMeta}
              episode={downloadFor}
              intent="download"
              error={downloadError}
              onBack={() => { setDownloadFor(null); setDownloadError(null); }}
              onClose={onClose}
              onPick={handleDownloadStream}
            />
          ) : pickingFor ? (
            <StreamsView
              meta={playbackMeta}
              episode={pickingFor}
              onBack={() => setPickingFor(null)}
              onClose={onClose}
              onPick={handlePickStream}
            />
          ) : (
            <>
              <header className="flex items-center justify-between gap-3 px-6 pb-4 pt-7">
                <div>
                  <p className="text-[10.5px] font-semibold uppercase tracking-[0.32em] text-ink-subtle">
                    {t("Up Next")}
                  </p>
                  <h2 className="mt-1 font-display text-[22px] font-semibold leading-tight text-ink">
                    {playbackMeta.name}
                  </h2>
                </div>
                <div className="flex shrink-0 items-center gap-2.5">
                  {canChooseQueue && (
                    <div
                      role="group"
                      aria-label={t("Next and Previous behavior")}
                      className="flex gap-0.5 rounded-full bg-elevated/60 p-0.5 ring-1 ring-edge-soft"
                    >
                      <button
                        type="button"
                        onClick={() => update({ queueDrivesNav: true })}
                        aria-pressed={followQueue}
                        title={t("Next and Previous follow your queue")}
                        className={`rounded-full px-2.5 py-1.5 text-[11px] font-semibold transition-colors ${followQueue ? "bg-accent text-canvas" : "text-ink-muted hover:text-ink"}`}
                      >
                        {t("Queue")}
                      </button>
                      <button
                        type="button"
                        onClick={() => update({ queueDrivesNav: false })}
                        aria-pressed={!followQueue}
                        title={t("Next and Previous follow this show")}
                        className={`rounded-full px-2.5 py-1.5 text-[11px] font-semibold transition-colors ${!followQueue ? "bg-accent text-canvas" : "text-ink-muted hover:text-ink"}`}
                      >
                        {t("This show")}
                      </button>
                    </div>
                  )}
                  <button
                    aria-label={t("Close")}
                    onClick={onClose}
                    data-tv-modal-close
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/10 text-ink-muted transition-[color,background-color,transform] hover:bg-white/15 hover:text-ink active:scale-[0.96]"
                  >
                    <X size={18} strokeWidth={2.2} />
                  </button>
                </div>
              </header>
              <div className="flex items-center justify-between gap-3 px-6 pb-3">
                {currentEpisode ? (
                  <p className="min-w-0 truncate text-[12.5px] text-ink-subtle">
                    {t("Now playing: {label}", {
                      label: `${displayEpLabel(currentEpisode, meta.id)}${
                        currentEpisode.name ? ` · ${currentEpisode.name}` : ""
                      }`,
                    })}
                  </p>
                ) : (
                  <span />
                )}
                {entryBrowser.entries.length > 1 ? (
                  <EntryPicker
                    entries={entryBrowser.entries.map((entry) => ({
                      id: entry.id,
                      label: entryLabel(entry),
                    }))}
                    activeId={entryBrowser.activeId ?? ""}
                    onSelect={(id) => {
                      if (season === 0) setSeason(1);
                      entryBrowser.browse(id);
                    }}
                    specials={
                      seasons.includes(0)
                        ? {
                            label: t("Specials"),
                            active: season === 0,
                            onSelect: () => setSeason(0),
                          }
                        : undefined
                    }
                  />
                ) : seasons.length > 1 ? (
                  <SeasonPicker seasons={seasons} active={season} onChange={setSeason} />
                ) : null}
              </div>
              <div ref={listRef} className="flex-1 overflow-y-auto px-4 pb-8 pt-2">
                {downloadNotice && <p role="status" className="mx-1 mb-3 rounded-xl bg-accent/10 px-3 py-2 text-[12px] text-accent">{downloadNotice}</p>}
                {preDownloadEpisode && preDownloadIsAired && (
                  <PreDownloadNextEpisode
                    key={preDownloadKey}
                    meta={meta}
                    episode={preDownloadEpisode}
                    currentEpisode={currentEpisode}
                    currentSource={currentStreamRef}
                    currentStreamUrl={currentStreamUrl ?? ""}
                    onToast={showPreDownloadToast}
                  />
                )}
                {followQueue && !hasQueue && (
                  <p role="status" className="px-1 py-5 text-sm text-ink-subtle">
                    {t("Your queue is empty. Add an item or switch to This show.")}
                  </p>
                )}
                {showQueueList && (
                  <QueueUpNext
                    meta={meta}
                    currentEpisode={currentEpisode}
                    roomGuest={roomGuest}
                    onClose={onClose}
                  />
                )}
                {followQueue && (
                  <button
                    type="button"
                    onClick={() => setShowEpsOpen((o) => !o)}
                    className="mt-5 flex w-full items-center justify-between border-t border-edge-soft/60 px-1 pt-4 text-[11px] font-bold uppercase tracking-[0.22em] text-ink-subtle transition-colors hover:text-ink"
                  >
                    {t("This show")}
                    <ChevronDown
                      size={16}
                      strokeWidth={2.4}
                      className={`transition-transform ${showEpsOpen ? "rotate-180" : ""}`}
                    />
                  </button>
                )}
                {(!followQueue || showEpsOpen) && (
                  <div className={followQueue ? "mt-3" : undefined}>
                    {meta.type === "series" && loading && episodes.length === 0 && (
                      <div className="flex items-center justify-center py-16">
                        <HarborLoader size="sm" />
                      </div>
                    )}
                    {meta.type === "series" && !loading && episodes.length === 0 && (
                      <p className="px-2 py-10 text-center text-[13.5px] text-ink-muted">
                        {t("No episodes found for this season.")}
                      </p>
                    )}
                    {episodes.length > 0 && (
                      <div className="flex flex-col gap-3">
                        {episodes.map((ep) => {
                          const key = `${ep.season}:${ep.episode}`;
                          const isCurrent = !!currentEpisode && sameEpisode(ep, currentEpisode);
                          const isNextUp = !!nextEp && sameEpisode(ep, nextEp);
                          const rowWatched =
                            isNextAired(false, ep.airDate) &&
                            (watchedFor?.(
                              ep,
                              playbackMeta.id,
                              ep.imdbId ?? null,
                              !entryBrowser.browsing,
                            ) ??
                              false);
                          // Navigation may already carry a synopsis even when the season
                          // provider omits it. Use that description until enrichment finishes.
                          const playbackOverview = [currentEpisode, nextEp].find((candidate) =>
                            candidate &&
                            (!candidate.sourceMetaId || candidate.sourceMetaId === playbackMeta.id) &&
                            sameEpisode(ep, candidate) &&
                            candidate.overview?.trim(),
                          )?.overview;
                          const rowEpisode = !ep.overview?.trim() && playbackOverview
                            ? { ...ep, overview: playbackOverview }
                            : ep;
                          return (
                            <EpisodeRow
                              key={key}
                              episode={rowEpisode}
                              metaId={playbackMeta.id}
                              imdbRating={imdbRatings.get(`${ep.season}:${ep.episode}`)}
                              expanded={expandedEp === key}
                              onToggle={() => setExpandedEp((cur) => (cur === key ? null : key))}
                              onPlay={() => {
                                if (isCurrent) {
                                  if (roomGuest) return;
                                  const saved = downloadsSnapshot().some((d) =>
                                    d.status === "done" && d.metaId === playbackMeta.id &&
                                    d.season === ep.season && d.episode === ep.episode,
                                  );
                                  if (saved) handlePlay(ep, true);
                                  else {
                                    onRestart?.();
                                    onClose();
                                  }
                                } else {
                                  handlePlay(ep);
                                }
                              }}
                              isCurrent={isCurrent}
                              onDownload={() => beginEpisodeDownload(ep)}
                              watched={rowWatched}
                              spoiler={spoilerMaskFor(settings, {
                                watched: isCurrent || rowWatched,
                                isNextUp,
                              })}
                            />
                          );
                        })}
                      </div>
                    )}
                    {(!loading || entryBrowser.browsing) && (prevJump || nextJump) && (
                      <div className="mt-3 flex gap-2">
                        {prevJump && (
                          <button
                            onClick={prevJump.go}
                            title={prevJump.label}
                            className="flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-2xl bg-elevated px-4 py-3.5 text-[13.5px] font-semibold text-ink ring-1 ring-edge-soft transition-colors hover:bg-raised"
                          >
                            <ChevronLeft size={16} strokeWidth={2.4} className="shrink-0 rtl:-scale-x-100" />
                            <span className="min-w-0 truncate">{prevJump.label}</span>
                          </button>
                        )}
                        {nextJump && (
                          <button
                            onClick={nextJump.go}
                            title={nextJump.label}
                            className="flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-2xl bg-elevated px-4 py-3.5 text-[13.5px] font-semibold text-ink ring-1 ring-edge-soft transition-colors hover:bg-raised"
                          >
                            <span className="min-w-0 truncate">{nextJump.label}</span>
                            <ChevronRight size={16} strokeWidth={2.4} className="shrink-0 rtl:-scale-x-100" />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </aside>
    </div>
    {preDownloadToast && (
      <div
        key={preDownloadToast.id}
        role="status"
        aria-live="polite"
        title={preDownloadToast.label}
        aria-label={preDownloadToast.label}
        style={{ animationDuration: `${preDownloadToastDurationMs(preDownloadToast.kind)}ms` }}
        className={`harbor-pre-download-toast pointer-events-none absolute top-1/2 z-[60] flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border bg-canvas/95 shadow-lg backdrop-blur-lg ${
          preDownloadToast.kind === "enabled" || preDownloadToast.kind === "completed"
            ? "border-emerald-400/35 text-emerald-400"
            : preDownloadToast.kind === "downloading"
              ? "border-sky-400/35 text-sky-400"
              : preDownloadToast.kind === "error"
                ? "border-amber-400/35 text-amber-400"
                : "border-edge-soft text-ink-muted"
        } ${
          open
            ? corner === "top-left" || corner === "bottom-left"
              ? "left-[calc(min(440px,100%)+12px)] max-[540px]:hidden"
              : "right-[calc(min(440px,100%)+12px)] max-[540px]:hidden"
            : corner === "top-left" || corner === "bottom-left"
              ? "left-[48px]"
              : "right-[48px]"
        }`}
      >
        {preDownloadToast.kind === "enabled" ? <ToggleRight size={18} aria-hidden="true" /> :
          preDownloadToast.kind === "disabled" ? <ToggleLeft size={18} aria-hidden="true" /> :
          preDownloadToast.kind === "downloading" ? <Download size={17} aria-hidden="true" /> :
          preDownloadToast.kind === "completed" ? <CheckCheck size={18} aria-hidden="true" /> :
          <AlertCircle size={18} aria-hidden="true" />}
        <span className="sr-only">{preDownloadToast.label}</span>
      </div>
    )}
    </>
  );
}
