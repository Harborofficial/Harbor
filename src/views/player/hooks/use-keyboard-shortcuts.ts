import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { PlayerBridge, PlayerSnapshot } from "@/lib/player/bridge";
import { writePlayerPrefs } from "@/lib/player-prefs";
import { writePlayerVolume } from "@/lib/player-volume";
import { createHotkeyMatcher, isPlayerHotkeyTarget, isTypingTarget } from "@/lib/hotkeys";
import { isWindowsDesktop } from "@/lib/platform";
import { isRtxHdrBlocked, isRtxVsrBlocked } from "@/lib/player/rtx-video-policy";
import { mediaKeyGate } from "@/lib/media-session";
import { setVideoOwnsMediaKeys } from "@/lib/player/media-key-owner";
import { useSettings } from "@/lib/settings";
import { isAnyFullscreen, exitAnyFullscreen } from "@/lib/fullscreen-state";
import { isBigPictureActive } from "@/lib/big-picture";
import { getLeaveConfirm, openLeaveConfirm } from "@/lib/player/leave-confirm";
import { isPlayerInteractionLocked } from "@/lib/player/interaction-lock";
import { HOLD_SPEED_DELAY_MS, holdSpeedRate } from "@/lib/player/hold-speed";
import { tracePlayback } from "@/lib/player/pause-trace";
import { round2 } from "../player-utils";
import { SFX } from "@/lib/sfx";

type InputConfBinding = {
  key: string;
  cmd: string;
};

function parseInputConf(raw?: string): Map<string, InputConfBinding> {
  const map = new Map<string, InputConfBinding>();
  if (!raw) return map;
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("//")) continue;
    const firstSpace = trimmed.search(/\s/);
    if (firstSpace > 0) {
      const key = trimmed.slice(0, firstSpace).trim();
      const cmd = trimmed.slice(firstSpace).trim();
      if (key && cmd) {
        map.set(key.toLowerCase(), { key, cmd });
      }
    }
  }
  return map;
}

function formatMpvProperty(val: unknown): string {
  if (val == null) return "";
  if (typeof val === "string") return val;
  if (typeof val === "number" || typeof val === "boolean") return String(val);
  if (Array.isArray(val)) {
    if (val.length === 0) return "none";
    const isMultiLineList = val.some(
      (item) =>
        typeof item === "string" && (item.includes("/") || item.includes("\\") || item.length > 25),
    );
    return val.map(formatMpvProperty).join(isMultiLineList ? "\n" : ", ");
  }
  if (typeof val === "object") {
    const entries = Object.entries(val as Record<string, unknown>);
    if (entries.length === 0) return "none";
    return entries.map(([k, v]) => `${k}=${formatMpvProperty(v)}`).join(", ");
  }
  return String(val);
}

async function triggerHarborOsd(cmd: string): Promise<void> {
  const showTextMatch = cmd.match(/show-text\s+(?:"([^"]+)"|'([^']+)'|([^\s;]+))/i);
  let template = showTextMatch
    ? (showTextMatch[1] ?? showTextMatch[2] ?? showTextMatch[3] ?? "")
    : "";

  if (!template) {
    const cycleMatch = cmd.match(/cycle-values\s+([a-zA-Z0-9_-]+)/i);
    if (cycleMatch) {
      template = `${cycleMatch[1]}: \${${cycleMatch[1]}}`;
    }
  }

  if (!template) return;

  // Brief pause so mpv executes the action command and updates the property
  await new Promise((resolve) => setTimeout(resolve, 50));

  const propMatches = Array.from(template.matchAll(/\$\{([a-zA-Z0-9_/-]+)\}/g));
  let result = template;

  for (const m of propMatches) {
    const fullTag = m[0];
    const propName = m[1];
    try {
      let displayVal: string;
      try {
        displayVal = await invoke<string>("mpv_get_property_osd", { name: propName });
      } catch {
        const val = await invoke<unknown>("mpv_get_property", { name: propName });
        displayVal = formatMpvProperty(val);
      }
      result = result.split(fullTag).join(displayVal);
    } catch {
      // Ignore if property is unavailable
    }
  }

  // Unescape literal newlines and tabs from input.conf so multiline text splits correctly
  result = result.replace(/\\n/g, "\n").replace(/\\N/g, "\n").replace(/\\t/g, "  ");

  window.dispatchEvent(new CustomEvent("harbor:osd", { detail: result }));
}

function eventToMpvKey(e: KeyboardEvent): string {
  let base = e.key;
  if (e.code === "Space" || e.key === " ") base = "SPACE";
  else if (e.code === "ArrowRight" || e.key === "ArrowRight") base = "RIGHT";
  else if (e.code === "ArrowLeft" || e.key === "ArrowLeft") base = "LEFT";
  else if (e.code === "ArrowUp" || e.key === "ArrowUp") base = "UP";
  else if (e.code === "ArrowDown" || e.key === "ArrowDown") base = "DOWN";
  else if (e.code === "Enter" || e.key === "Enter") base = "ENTER";
  else if (e.code === "Escape" || e.key === "Escape") base = "ESC";
  else if (e.code === "Backspace" || e.key === "Backspace") base = "BS";
  else if (e.code === "Tab" || e.key === "Tab") base = "TAB";
  else if (e.code === "PageUp") base = "PGUP";
  else if (e.code === "PageDown") base = "PGDWN";
  else if (e.code === "Home") base = "HOME";
  else if (e.code === "End") base = "END";
  else if (e.code === "Insert") base = "INS";
  else if (e.code === "Delete") base = "DEL";

  let prefix = "";
  if (e.ctrlKey) prefix += "Ctrl+";
  if (e.altKey) prefix += "Alt+";
  if (e.metaKey) prefix += "Meta+";
  if (e.shiftKey && (base.length > 1 || !/^[a-zA-Z0-9]$/.test(base))) prefix += "Shift+";

  return prefix + base;
}

export function useKeyboardShortcuts(params: {
  bridgeRef: RefObject<PlayerBridge | null>;
  snap: PlayerSnapshot;
  drawMode: boolean;
  setDrawMode: (v: boolean) => void;
  closePlayer: () => void;
  returnToPreview?: () => void;
  playPauseToggle: () => void;
  seekStep: (delta: number) => void;
  seekTo: (sec: number) => void;
  onFrameStep?: (dir: 1 | -1) => void;
  toggleFullscreen: () => void;
  togglePip?: () => void;
  fullscreen: boolean;
  cycleSubtitles: () => void;
  showStats: boolean;
  setShowStats: (updater: (prev: boolean) => boolean) => void;
  setStatsPage: (page: 0 | 1 | 2 | 3 | 4 | 5) => void;
  showConsole?: boolean;
  setShowConsole?: (updater: (prev: boolean) => boolean) => void;
  metaId: string;
  svpActive: boolean;
  onNextEp?: () => void;
  onPrevEp?: () => void;
  hasNextEp?: boolean;
  hasPrevEp?: boolean;
  toggleSwitcher?: () => void;
  toggleEpisodePanel?: () => void;
  toggleGuide?: () => void;
  toggleDvr?: () => void;
  toggleSleep?: () => void;
  onScreenshot?: () => void;
  onGifRecord?: () => void;
  onClipRecord?: () => void;
  onToggleCrop?: () => void;
  onPanscanUp?: () => void;
  onPanscanDown?: () => void;
  onPrevChannel?: () => void;
  onToggleAnime4k?: () => void;
  onAnime4kOn?: () => void;
  onAnime4kOff?: () => void;
  onReloadSource?: () => void;
  onRestartServer?: () => void;
  onVolumeFeedback?: (volume: number, muted: boolean) => void;
}) {
  const {
    bridgeRef,
    snap,
    drawMode,
    setDrawMode,
    closePlayer,
    returnToPreview,
    playPauseToggle,
    seekStep,
    seekTo,
    onFrameStep,
    toggleFullscreen,
    togglePip,
    cycleSubtitles,
    showStats,
    setShowStats,
    setStatsPage,
    showConsole,
    setShowConsole,
    metaId,
    svpActive,
    onNextEp,
    onPrevEp,
    hasNextEp,
    hasPrevEp,
    toggleSwitcher,
    toggleEpisodePanel,
    toggleGuide,
    toggleDvr,
    toggleSleep,
    onScreenshot,
    onGifRecord,
    onClipRecord,
    onToggleCrop,
    onPanscanUp,
    onPanscanDown,
    onPrevChannel,
    onToggleAnime4k,
    onAnime4kOn,
    onAnime4kOff,
    onReloadSource,
    onRestartServer,
    onVolumeFeedback,
  } = params;
  const { settings, update } = useSettings();

  const inputConfMap = useMemo(() => {
    if (!settings.mpvInputConf?.trim()) return new Map<string, InputConfBinding>();
    return parseInputConf(settings.mpvInputConf);
  }, [settings.mpvInputConf]);

  const showStatsRef = useRef(showStats);
  showStatsRef.current = showStats;
  const showConsoleRef = useRef(Boolean(showConsole));
  showConsoleRef.current = Boolean(showConsole);
  const mpvConsoleRef = useRef(Boolean(settings.mpvConsole));
  mpvConsoleRef.current = Boolean(settings.mpvConsole);
  const mpvDetailedStatsRef = useRef(Boolean(settings.mpvDetailedStats));
  mpvDetailedStatsRef.current = Boolean(settings.mpvDetailedStats);
  const inputConfMapRef = useRef(inputConfMap);
  inputConfMapRef.current = inputConfMap;

  const nativeBindingsRef = useRef<Map<string, string>>(new Map());
  useEffect(() => {
    if (bridgeRef.current?.capabilities().engine !== "mpv") {
      nativeBindingsRef.current.clear();
      return;
    }
    let cancelled = false;
    const fetchBindings = async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const list = await invoke<Array<{ key?: string; cmd?: string }>>("mpv_get_property", {
          name: "input-bindings",
        });
        if (!cancelled && Array.isArray(list)) {
          const map = new Map<string, string>();
          for (const item of list) {
            if (item?.key && item?.cmd) {
              map.set(item.key.toLowerCase(), item.cmd);
            }
          }
          nativeBindingsRef.current = map;
        }
      } catch {
        // mpv may not have loaded or property not ready yet
      }
    };
    void fetchBindings();
    const interval = window.setInterval(() => {
      if (nativeBindingsRef.current.size === 0) void fetchBindings();
    }, 1500);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [bridgeRef, settings.mpvInputConf]);

  const overrides = settings.hotkeys ?? {};
  const seekBackStepSec = settings.seekBackStepSec;
  const seekForwardStepSec = settings.seekForwardStepSec;
  const seekBackStepShortSec = settings.seekBackStepShortSec;
  const seekForwardStepShortSec = settings.seekForwardStepShortSec;
  const [subtitleOffsetSec, setSubtitleOffsetSec] = useState<number | null>(null);
  const subtitleOffsetTimerRef = useRef<number | null>(null);
  const showSubtitleOffset = (delaySec: number) => {
    setSubtitleOffsetSec(delaySec);
    if (subtitleOffsetTimerRef.current != null) {
      window.clearTimeout(subtitleOffsetTimerRef.current);
    }
    subtitleOffsetTimerRef.current = window.setTimeout(() => {
      setSubtitleOffsetSec(null);
      subtitleOffsetTimerRef.current = null;
    }, 1800);
  };
  useEffect(
    () => () => {
      if (subtitleOffsetTimerRef.current != null) {
        window.clearTimeout(subtitleOffsetTimerRef.current);
      }
    },
    [],
  );

  const holdRef = useRef<{
    key: string | null;
    timer: number | null;
    engaged: boolean;
    baseRate: number;
  }>({ key: null, timer: null, engaged: false, baseRate: 1 });
  const [holdSpeedActive, setHoldSpeedActive] = useState(false);
  const mediaRef = useRef({
    status: snap.status,
    playPauseToggle,
    seekStep,
    seekTo,
    onNextEp,
    onPrevEp,
    hasNextEp,
    hasPrevEp,
  });
  mediaRef.current = {
    status: snap.status,
    playPauseToggle,
    seekStep,
    seekTo,
    onNextEp,
    onPrevEp,
    hasNextEp,
    hasPrevEp,
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.key.startsWith("Media") && !isPlayerHotkeyTarget(e)) return;
      if (isPlayerInteractionLocked()) {
        if (e.cancelable) e.preventDefault();
        return;
      }
      if (isTypingTarget(e)) return;

      if (e.key === "Escape") {
        window.dispatchEvent(new CustomEvent("harbor:stats-hide"));
      }

      if (showStatsRef.current) {
        if (e.key === "Escape") {
          e.preventDefault();
          setShowStats(() => false);
          return;
        }
        if (mpvDetailedStatsRef.current && bridgeRef.current?.capabilities().engine === "mpv") {
          if (!e.ctrlKey && !e.metaKey && !e.altKey) {
            if (e.key >= "0" && e.key <= "5") {
              e.preventDefault();
              setStatsPage(parseInt(e.key, 10) as 0 | 1 | 2 | 3 | 4 | 5);
              return;
            }
          }
        }
      }

      if (e.key === "`" || e.key === "~") {
        if (showStatsRef.current) return;
        if (mpvConsoleRef.current && bridgeRef.current?.capabilities().engine === "mpv") {
          e.preventDefault();
          setShowConsole?.((v) => !v);
          return;
        }
      }

      if (showConsoleRef.current) {
        if (e.key === "Escape" || e.key === "`" || e.key === "~") {
          e.preventDefault();
          setShowConsole?.(() => false);
          return;
        }
      }

      if (bridgeRef.current?.capabilities().engine === "mpv") {
        const mpvKey = eventToMpvKey(e);
        const lowerKey = mpvKey.toLowerCase();
        const lowerDomKey = e.key.toLowerCase();
        const matchedCmd =
          nativeBindingsRef.current.get(lowerKey) ||
          nativeBindingsRef.current.get(lowerDomKey) ||
          inputConfMapRef.current.get(lowerKey)?.cmd ||
          inputConfMapRef.current.get(lowerDomKey)?.cmd;

        if (matchedCmd) {
          e.preventDefault();

          // 1. Check for stats page commands (e.g. script-binding stats/display-page-1, display-stats, etc.)
          const statsMatch = matchedCmd.match(
            /stats\/(?:display-page-(\d+)|display-stats(?:-toggle)?)/i,
          );
          if (statsMatch) {
            const pageNum = statsMatch[1] ? parseInt(statsMatch[1], 10) : 1;
            window.dispatchEvent(
              new CustomEvent("harbor:toggle-stats-page", { detail: { page: pageNum } }),
            );
            return;
          }

          // 2. Harbor styled OSD HUD for show-text or cycle-values
          if (/show-text|cycle-values\b/i.test(matchedCmd)) {
            void triggerHarborOsd(matchedCmd);
          }

          // 3. Forward matched key through native mpv_keypress so mpv handles
          // comments, sections, prefixes (repeatable), and commands outside allowlists
          void invoke("mpv_keypress", { key: mpvKey }).catch(() => {});
          return;
        }
      }

      const match = createHotkeyMatcher(e, overrides, "Player");

      if (e.key.startsWith("Media")) tracePlayback(`media-key-dom ${e.key}`);

      if (e.key === "MediaPlayPause") {
        e.preventDefault();
        if (mediaKeyGate()) playPauseToggle();
        return;
      }
      if (e.key === "MediaPlay") {
        e.preventDefault();
        if (mediaRef.current.status !== "playing" && mediaKeyGate()) playPauseToggle();
        return;
      }
      if (e.key === "MediaPause" || e.key === "MediaStop") {
        e.preventDefault();
        if (mediaRef.current.status === "playing" && mediaKeyGate()) playPauseToggle();
        return;
      }
      if (e.key === "MediaTrackNext" && hasNextEp && onNextEp) {
        e.preventDefault();
        if (mediaKeyGate()) onNextEp();
        return;
      }
      if (e.key === "MediaTrackPrevious" && hasPrevEp && onPrevEp) {
        e.preventDefault();
        if (mediaKeyGate()) onPrevEp();
        return;
      }

      if (match("playerClose")) {
        if (getLeaveConfirm().open) return;
        if (drawMode) {
          setDrawMode(false);
          return;
        }
        if (returnToPreview) {
          e.preventDefault();
          returnToPreview();
          return;
        }
        void (async () => {
          if (
            settings.playerEscExitsFullscreen &&
            !isBigPictureActive() &&
            (await isAnyFullscreen())
          ) {
            await exitAnyFullscreen();
            return;
          }
          if (settings.playerConfirmLeave) {
            openLeaveConfirm((remember) => {
              if (remember) update({ playerConfirmLeave: false });
              closePlayer();
            });
            return;
          }
          closePlayer();
        })();
        return;
      }
      if (match("playerPip")) {
        e.preventDefault();
        togglePip?.();
        return;
      }
      if (match("playerPlayPause")) {
        e.preventDefault();
        if (e.repeat) return;
        const h = holdRef.current;
        h.key = e.key;
        h.baseRate = snap.rate;
        h.timer = window.setTimeout(() => {
          h.timer = null;
          h.engaged = true;
          setHoldSpeedActive(true);
          bridgeRef.current?.setRate(holdSpeedRate(h.baseRate));
        }, HOLD_SPEED_DELAY_MS);
        return;
      }
      if (match("playerSeekBack10")) {
        e.preventDefault();
        seekStep(-seekBackStepSec);
        return;
      }
      if (match("playerSeekForward10")) {
        e.preventDefault();
        seekStep(seekForwardStepSec);
        return;
      }
      if (match("playerSeekBackShort")) {
        e.preventDefault();
        seekStep(-seekBackStepShortSec);
        return;
      }
      if (match("playerSeekForwardShort")) {
        e.preventDefault();
        seekStep(seekForwardStepShortSec);
        return;
      }
      if (match("playerSeekBack30")) {
        e.preventDefault();
        seekStep(-30);
        return;
      }
      if (match("playerSeekForward30")) {
        e.preventDefault();
        seekStep(30);
        return;
      }
      if (match("playerFrameForward") && onFrameStep) {
        e.preventDefault();
        onFrameStep(1);
        return;
      }
      if (match("playerFrameBack") && onFrameStep) {
        e.preventDefault();
        onFrameStep(-1);
        return;
      }
      if (match("playerVolumeUp")) {
        e.preventDefault();
        const step = e.shiftKey ? 0.5 : 0.05;
        const max =
          bridgeRef.current?.capabilities().engine === "mpv"
            ? Math.max(1, Math.min(6, settings.volumeBoostMax || 2))
            : 1;
        const next = Math.min(max, Math.max(0, snap.volume + step));
        bridgeRef.current?.setVolume(next);
        bridgeRef.current?.setMuted(false);
        writePlayerVolume({ volume: next, muted: false });
        onVolumeFeedback?.(next, false);
        if (settings.playerVolumeSfx) SFX.volumeChange(true);
        return;
      }
      if (match("playerVolumeDown")) {
        e.preventDefault();
        const step = e.shiftKey ? 0.5 : 0.05;
        const max =
          bridgeRef.current?.capabilities().engine === "mpv"
            ? Math.max(1, Math.min(6, settings.volumeBoostMax || 2))
            : 1;
        const next = Math.min(max, Math.max(0, snap.volume - step));
        bridgeRef.current?.setVolume(next);
        bridgeRef.current?.setMuted(false);
        writePlayerVolume({ volume: next, muted: false });
        onVolumeFeedback?.(next, false);
        if (settings.playerVolumeSfx) SFX.volumeChange(false);
        return;
      }
      if (match("playerMute")) {
        e.preventDefault();
        const next = !snap.muted;
        bridgeRef.current?.setMuted(next);
        writePlayerVolume({ muted: next });
        onVolumeFeedback?.(snap.volume, next);
        if (settings.playerVolumeSfx) SFX.volumeChange(true);
        return;
      }
      if (match("playerFullscreen")) {
        e.preventDefault();
        toggleFullscreen();
        return;
      }
      if (match("playerCrop") && onToggleCrop) {
        e.preventDefault();
        onToggleCrop();
        return;
      }
      if (match("playerAnime4kToggle") && onToggleAnime4k) {
        e.preventDefault();
        onToggleAnime4k();
        return;
      }
      if (match("playerAnime4kOn") && onAnime4kOn) {
        e.preventDefault();
        onAnime4kOn();
        return;
      }
      if (match("playerAnime4kOff") && onAnime4kOff) {
        e.preventDefault();
        onAnime4kOff();
        return;
      }
      if (match("playerRtxHdrToggle")) {
        e.preventDefault();
        if (e.repeat) return;
        if (!isWindowsDesktop() || isRtxHdrBlocked(settings.playerHdrToSdr, svpActive)) return;
        if (bridgeRef.current?.capabilities().engine !== "mpv") return;
        update({ playerRtxHdr: !settings.playerRtxHdr });
        return;
      }
      if (match("playerRtxVsrToggle")) {
        e.preventDefault();
        if (e.repeat) return;
        if (!isWindowsDesktop() || isRtxVsrBlocked(svpActive)) return;
        if (bridgeRef.current?.capabilities().engine !== "mpv") return;
        update({ playerRtxVsr: !settings.playerRtxVsr });
        return;
      }
      if (match("playerPanscanUp") && onPanscanUp) {
        e.preventDefault();
        onPanscanUp();
        return;
      }
      if (match("playerPanscanDown") && onPanscanDown) {
        e.preventDefault();
        onPanscanDown();
        return;
      }
      if (match("playerPrevChannel") && onPrevChannel) {
        e.preventDefault();
        onPrevChannel();
        return;
      }
      if (match("playerSubtitleCycle") || match("playerSubtitleCycleAlt")) {
        e.preventDefault();
        cycleSubtitles();
        return;
      }
      if (match("playerNextEpisode") && hasNextEp && onNextEp) {
        e.preventDefault();
        onNextEp();
        return;
      }
      if (match("playerPrevEpisode") && hasPrevEp && onPrevEp) {
        e.preventDefault();
        onPrevEp();
        return;
      }
      if (match("playerStart")) {
        e.preventDefault();
        seekTo(0);
        return;
      }
      if (match("playerEnd")) {
        e.preventDefault();
        if (snap.durationSec > 0) seekTo(snap.durationSec - 0.5);
        return;
      }
      if (match("playerStats")) {
        e.preventDefault();
        setShowStats((v) => {
          if (!v) setStatsPage(1);
          return !v;
        });
        return;
      }
      if (match("playerSpeedDown")) {
        e.preventDefault();
        const r = Math.max(0.25, +(snap.rate - 0.25).toFixed(2));
        bridgeRef.current?.setRate(r);
        writePlayerPrefs(metaId, { rate: r });
        return;
      }
      if (match("playerSpeedUp")) {
        e.preventDefault();
        const r = Math.min(3, +(snap.rate + 0.25).toFixed(2));
        bridgeRef.current?.setRate(r);
        writePlayerPrefs(metaId, { rate: r });
        return;
      }
      if (match("playerSubDelayDown")) {
        e.preventDefault();
        const step = e.shiftKey ? 0.05 : 0.1;
        const delay = round2(snap.subDelaySec - step);
        bridgeRef.current?.setSubDelay(delay);
        showSubtitleOffset(delay);
        writePlayerPrefs(metaId, { subDelaySec: delay });
        return;
      }
      if (match("playerSubDelayUp")) {
        e.preventDefault();
        const step = e.shiftKey ? 0.05 : 0.1;
        const delay = round2(snap.subDelaySec + step);
        bridgeRef.current?.setSubDelay(delay);
        showSubtitleOffset(delay);
        writePlayerPrefs(metaId, { subDelaySec: delay });
        return;
      }
      if (match("playerStreamSwitcher") && toggleSwitcher) {
        e.preventDefault();
        toggleSwitcher();
        return;
      }
      if (match("playerEpisodePanel") && toggleEpisodePanel) {
        e.preventDefault();
        toggleEpisodePanel();
        return;
      }
      if (match("playerTvGuide") && toggleGuide) {
        e.preventDefault();
        toggleGuide();
        return;
      }
      if (match("playerDvr") && toggleDvr) {
        e.preventDefault();
        toggleDvr();
        return;
      }
      if (match("playerSleep") && toggleSleep) {
        e.preventDefault();
        toggleSleep();
        return;
      }
      if (match("playerScreenshot") && onScreenshot) {
        e.preventDefault();
        if (e.repeat) return;
        onScreenshot();
        return;
      }
      if (match("playerGifRecord") && onGifRecord) {
        e.preventDefault();
        if (e.repeat) return;
        onGifRecord();
        return;
      }
      if (match("playerClipRecord") && onClipRecord) {
        e.preventDefault();
        if (e.repeat) return;
        onClipRecord();
        return;
      }
      if (match("playerReloadSource") && onReloadSource) {
        e.preventDefault();
        if (e.repeat) return;
        onReloadSource();
        return;
      }
      if (match("playerRestartServer") && onRestartServer) {
        e.preventDefault();
        if (e.repeat) return;
        onRestartServer();
        return;
      }
      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        if (e.key === "0") {
          e.preventDefault();
          seekTo(0);
          return;
        }
        const digit = parseInt(e.key, 10);
        if (!Number.isNaN(digit) && digit >= 1 && digit <= 9) {
          e.preventDefault();
          if (snap.durationSec > 0) {
            seekTo((snap.durationSec * digit) / 10);
          }
          return;
        }
      }
    };
    const releaseHold = () => {
      const h = holdRef.current;
      h.key = null;
      if (h.timer != null) {
        window.clearTimeout(h.timer);
        h.timer = null;
        return "tap" as const;
      }
      if (h.engaged) {
        h.engaged = false;
        setHoldSpeedActive(false);
        bridgeRef.current?.setRate(h.baseRate);
      }
      return "held" as const;
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const h = holdRef.current;
      if (isPlayerInteractionLocked()) {
        if (e.cancelable) e.preventDefault();
        if (h.key != null && e.key === h.key) releaseHold();
        return;
      }
      if (h.key == null || e.key !== h.key) return;
      if (releaseHold() === "tap") playPauseToggle();
    };
    const onBlur = () => {
      if (holdRef.current.key != null) releaseHold();
    };
    const onToggleStatsPage = (e: Event) => {
      if (!mpvDetailedStatsRef.current || bridgeRef.current?.capabilities().engine !== "mpv")
        return;
      const ce = e as CustomEvent<{ page?: number }>;
      const targetPage = ce.detail?.page ?? 1;
      setShowStats((prev) => {
        if (!prev) {
          if (targetPage >= 0 && targetPage <= 5) {
            setStatsPage(targetPage as 0 | 1 | 2 | 3 | 4 | 5);
          }
          return true;
        }
        if (targetPage >= 0 && targetPage <= 5) {
          setStatsPage(targetPage as 0 | 1 | 2 | 3 | 4 | 5);
          return true;
        }
        return false;
      });
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    window.addEventListener("harbor:toggle-stats-page", onToggleStatsPage);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("harbor:toggle-stats-page", onToggleStatsPage);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    closePlayer,
    returnToPreview,
    togglePip,
    drawMode,
    snap.muted,
    snap.volume,
    snap.rate,
    snap.durationSec,
    snap.subDelaySec,
    overrides,
    seekBackStepSec,
    seekForwardStepSec,
    seekBackStepShortSec,
    seekForwardStepShortSec,
    seekTo,
    toggleSwitcher,
    toggleEpisodePanel,
    toggleGuide,
    toggleDvr,
    toggleSleep,
    onScreenshot,
    onGifRecord,
    onClipRecord,
    onToggleCrop,
    onPanscanUp,
    onPanscanDown,
    onPrevChannel,
    onToggleAnime4k,
    onAnime4kOn,
    onAnime4kOff,
    onReloadSource,
    onRestartServer,
    onFrameStep,
    onVolumeFeedback,
    settings.playerEscExitsFullscreen,
    settings.playerConfirmLeave,
    settings.playerVolumeSfx,
    settings.playerHdrToSdr,
    settings.playerRtxHdr,
    settings.playerRtxVsr,
    svpActive,
    update,
  ]);

  useEffect(() => {
    if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return;
    setVideoOwnsMediaKeys(true);
    let dead = false;
    let cleanup: (() => void) | undefined;
    void import("@tauri-apps/api/event").then(async ({ listen }) => {
      const u1 = await listen<string>("harbor://media-key", (e) => {
        const m = mediaRef.current;
        const playing = m.status === "playing";
        tracePlayback(`media-key ${e.payload} status=${m.status}`);
        switch (e.payload) {
          case "playpause":
            if (mediaKeyGate()) m.playPauseToggle();
            break;
          case "play":
            if (!playing && mediaKeyGate()) m.playPauseToggle();
            break;
          case "pause":
          case "stop":
            if (playing && mediaKeyGate()) m.playPauseToggle();
            break;
          case "next":
            if (m.hasNextEp && m.onNextEp && mediaKeyGate()) m.onNextEp();
            break;
          case "previous":
            if (m.hasPrevEp && m.onPrevEp && mediaKeyGate()) m.onPrevEp();
            break;
        }
      });
      const u2 = await listen<number>("harbor://media-seek-relative", (e) => {
        if (typeof e.payload === "number" && Number.isFinite(e.payload)) {
          mediaRef.current.seekStep(e.payload);
        }
      });
      const u3 = await listen<number>("harbor://media-seek-absolute", (e) => {
        if (typeof e.payload === "number" && Number.isFinite(e.payload)) {
          mediaRef.current.seekTo(e.payload);
        }
      });
      const u4 = await listen<number>("harbor://media-set-volume", (e) => {
        if (typeof e.payload === "number" && Number.isFinite(e.payload)) {
          const vol = Math.max(0, Math.min(1, e.payload));
          bridgeRef.current?.setVolume(vol);
          bridgeRef.current?.setMuted(false);
          writePlayerVolume({ volume: vol, muted: false });
          onVolumeFeedback?.(vol, false);
        }
      });
      if (dead) {
        u1();
        u2();
        u3();
        u4();
      } else {
        cleanup = () => {
          u1();
          u2();
          u3();
          u4();
        };
      }
    });
    return () => {
      dead = true;
      setVideoOwnsMediaKeys(false);
      cleanup?.();
    };
  }, []);

  return { holdSpeedActive, subtitleOffsetSec };
}
