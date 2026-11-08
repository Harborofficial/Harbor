import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Music2, Pause, Play, RefreshCw, Volume2, VolumeX } from "lucide-react";
import { useT } from "@/lib/i18n";
import { useSettings } from "@/lib/settings";
import { openLinkOut } from "@/lib/social/link-out";
import {
  audioTimes,
  fetchAudioMeta,
  parseProfileAudio,
  sendAudioCommand,
  sendAudioVolume,
  type AudioMeta,
} from "@/lib/social/profile-audio";
import {
  canResolveProfileAudio,
  clearProfileAudioCache,
  resolveProfileAudio,
} from "@/lib/social/profile-audio-native";
import { registerStreamProxy, releaseStreamProxy } from "@/lib/stream-proxy";

const VOLUME_KEY = "harbor.profileAudioVolume.v1";

function readSavedVolume(): number {
  try {
    const raw = localStorage.getItem(VOLUME_KEY);
    if (raw != null) {
      const v = Number(raw);
      if (Number.isFinite(v) && v >= 0 && v <= 100) return v;
    }
  } catch {}
  return 70;
}

function saveVolume(v: number): void {
  try {
    localStorage.setItem(VOLUME_KEY, String(v));
  } catch {}
}

function releaseSession(session: string | null): void {
  if (session) releaseStreamProxy(session);
}

export function ProfileAudioCard({ audioUrl }: { audioUrl?: string }) {
  const t = useT();
  const { settings, update } = useSettings();
  const mode = settings.profileAudio ?? "auto";
  const [meta, setMeta] = useState<AudioMeta | null>(null);
  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(readSavedVolume);
  const [barOpen, setBarOpen] = useState(false);
  const [mountMuted, setMountMuted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const parsed = useMemo(() => (audioUrl ? parseProfileAudio(audioUrl) : null), [audioUrl]);
  const embed = useMemo(
    () => (audioUrl ? parseProfileAudio(audioUrl, { autoplay: true, muted: mountMuted }) : null),
    [audioUrl, mountMuted],
  );
  const isSpotify = parsed?.provider === "spotify";
  const useNative = canResolveProfileAudio() && !isSpotify;

  const frameRef = useRef<HTMLIFrameElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const proxyRef = useRef<string | null>(null);
  const startRef = useRef<number | null>(null);
  const endRef = useRef<number | null>(null);
  const requestRef = useRef(0);
  const playingRef = useRef(playing);
  const mutedRef = useRef(muted);
  const volumeRef = useRef(volume);
  playingRef.current = playing;
  mutedRef.current = muted;
  volumeRef.current = volume;

  useEffect(() => {
    setStarted(false);
    setPlaying(false);
    setMuted(false);
    setMeta(null);
    setLoading(false);
    setFailed(false);
    setAttempt(0);
    if (!parsed) return;
    const ctrl = new AbortController();
    void fetchAudioMeta(parsed, ctrl.signal).then((m) => {
      if (!ctrl.signal.aborted) setMeta(m);
    });
    return () => ctrl.abort();
  }, [parsed]);

  useEffect(() => {
    if (mode !== "off") return;
    setStarted(false);
    setPlaying(false);
    setLoading(false);
    setFailed(false);
  }, [mode]);

  useEffect(() => {
    if (!parsed || parsed.provider === "spotify" || mode !== "auto" || started) return;
    if (useNative) {
      setMountMuted(muted);
      setStarted(true);
      setPlaying(true);
      return;
    }
    let cancelled = false;
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        if (cancelled) return;
        setMountMuted(muted);
        setStarted(true);
        setPlaying(true);
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(first);
      if (second) cancelAnimationFrame(second);
    };
  }, [parsed, mode, started, muted, useNative]);

  const startPlay = () => {
    setMountMuted(muted);
    setStarted(true);
    setPlaying(true);
    setFailed(false);
  };

  const retry = () => {
    setFailed(false);
    setPlaying(true);
    setStarted(true);
    setAttempt((value) => value + 1);
  };

  useEffect(() => {
    if (!useNative || !started) return;
    const el = new Audio();
    el.preload = "auto";
    el.muted = mutedRef.current;
    el.volume = Math.max(0, Math.min(1, volumeRef.current / 100));
    const onPlaying = () => {
      setPlaying(true);
      setLoading(false);
      setFailed(false);
    };
    const onEnded = () => setPlaying(false);
    const onError = () => {
      const session = proxyRef.current;
      proxyRef.current = null;
      releaseSession(session);
      if (parsed) clearProfileAudioCache(parsed);
      setLoading(false);
      setFailed(true);
      setPlaying(false);
    };
    const onTime = () => {
      const end = endRef.current;
      if (end != null && el.currentTime >= end - 0.15) {
        el.pause();
        setPlaying(false);
      }
    };
    el.addEventListener("playing", onPlaying);
    el.addEventListener("ended", onEnded);
    el.addEventListener("error", onError);
    el.addEventListener("timeupdate", onTime);
    audioRef.current = el;
    return () => {
      el.removeEventListener("playing", onPlaying);
      el.removeEventListener("ended", onEnded);
      el.removeEventListener("error", onError);
      el.removeEventListener("timeupdate", onTime);
      el.pause();
      el.removeAttribute("src");
      el.load();
      if (audioRef.current === el) audioRef.current = null;
    };
  }, [useNative, started, parsed]);

  useEffect(() => {
    if (!useNative || !started || !parsed) return;
    const el = audioRef.current;
    if (!el) return;
    const request = ++requestRef.current;
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    const times = audioTimes(audioUrl ?? "");
    startRef.current = times.startSec;
    endRef.current = times.endSec;
    void (async () => {
      try {
        const stream = await resolveProfileAudio(parsed, { force: attempt > 0 });
        if (cancelled || request !== requestRef.current) return;
        const proxy = await registerStreamProxy(stream.url, stream.headers, {
          prebufferBytes: 256_000,
        });
        if (cancelled || request !== requestRef.current) {
          releaseStreamProxy(proxy.sessionId);
          return;
        }
        const previous = proxyRef.current;
        proxyRef.current = proxy.sessionId;
        if (previous && previous !== proxy.sessionId) releaseStreamProxy(previous);
        el.src = proxy.url;
        el.muted = mutedRef.current;
        el.volume = Math.max(0, Math.min(1, volumeRef.current / 100));
        const start = startRef.current;
        if (start != null && start > 0) {
          const seek = () => {
            if (el.readyState >= 1) el.currentTime = start;
          };
          if (el.readyState >= 1) seek();
          else el.addEventListener("loadedmetadata", seek, { once: true });
        }
        if (!playingRef.current) {
          setLoading(false);
          return;
        }
        try {
          await el.play();
        } catch (error) {
          if (!cancelled && request === requestRef.current) {
            setLoading(false);
            setPlaying(false);
            const name = error instanceof DOMException ? error.name : "";
            if (name !== "NotAllowedError" && name !== "AbortError") {
              setFailed(true);
            }
          }
          return;
        }
        if (!cancelled && request === requestRef.current) {
          setLoading(false);
          setPlaying(true);
        }
      } catch {
        if (!cancelled && request === requestRef.current) {
          setLoading(false);
          setFailed(true);
          setPlaying(false);
        }
      }
    })();
    return () => {
      cancelled = true;
      requestRef.current += 1;
      const session = proxyRef.current;
      proxyRef.current = null;
      releaseSession(session);
      if (el.getAttribute("src")) {
        el.pause();
        el.removeAttribute("src");
        el.load();
      }
    };
  }, [useNative, started, parsed, audioUrl, attempt]);

  useEffect(() => {
    if (!useNative || !started) return;
    const el = audioRef.current;
    if (!el || !el.getAttribute("src")) return;
    if (!playing) {
      el.pause();
      return;
    }
    const start = startRef.current ?? 0;
    const end = endRef.current;
    if (el.ended || (end != null && el.currentTime >= end - 0.2)) {
      el.currentTime = start;
    }
    void el.play().catch(() => {
      if (!el.paused) return;
      setPlaying(false);
    });
  }, [playing, useNative, started]);

  useEffect(() => {
    const el = audioRef.current;
    if (el) el.volume = Math.max(0, Math.min(1, volume / 100));
  }, [volume, started, useNative]);

  useEffect(() => {
    const el = audioRef.current;
    if (el) el.muted = muted;
  }, [muted, started, useNative]);

  useEffect(() => {
    if (useNative || !started || isSpotify) return;
    sendAudioCommand(frameRef.current, parsed?.provider ?? "youtube", playing ? "play" : "pause");
  }, [playing, started, useNative, isSpotify, parsed?.provider]);

  useEffect(() => {
    if (useNative || !started || isSpotify) return;
    sendAudioCommand(frameRef.current, parsed?.provider ?? "youtube", muted ? "mute" : "unmute");
  }, [muted, started, useNative, isSpotify, parsed?.provider]);

  useEffect(() => {
    if (useNative || !started || isSpotify || muted) return;
    sendAudioVolume(frameRef.current, parsed?.provider ?? "youtube", volume);
  }, [volume, started, useNative, isSpotify, muted, parsed?.provider]);

  const onVolumeDrag = (next: number) => {
    setVolume(next);
    saveVolume(next);
    if (next > 0 && muted) setMuted(false);
  };

  if (!parsed || mode === "off") return null;

  const title = meta?.title || t("Now playing");

  if (isSpotify) {
    return (
      <section
        aria-label={t("Profile song")}
        className="relative rounded-lg bg-surface ring-1 ring-edge-soft"
      >
        <iframe
          src={parsed.embedSrc}
          title={title}
          loading="lazy"
          allow="encrypted-media; clipboard-write"
          referrerPolicy="strict-origin-when-cross-origin"
          className="block h-[152px] w-full rounded-lg border-0"
        />
      </section>
    );
  }

  return (
    <section
      aria-label={t("Profile song")}
      className="relative rounded-lg bg-surface ring-1 ring-edge-soft"
    >
      <div className="flex items-center gap-3 p-3">
        <button
          type="button"
          onClick={() => {
            if (loading) return;
            if (failed) {
              retry();
              return;
            }
            if (started) setPlaying((p) => !p);
            else startPlay();
          }}
          aria-label={loading ? t("Loading") : playing ? t("Pause") : t("Play")}
          className="relative grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-md bg-elevated ring-1 ring-edge-soft"
        >
          {meta?.thumbnail ? (
            <img
              src={meta.thumbnail}
              alt=""
              draggable={false}
              className="h-full w-full object-cover"
            />
          ) : (
            <Music2 size={18} className="text-ink-subtle" />
          )}
          <span
            className={`absolute inset-0 grid place-items-center bg-canvas/55 ${
              loading ? "opacity-100" : "opacity-0 transition-opacity hover:opacity-100"
            }`}
          >
            {loading ? (
              <Loader2 size={16} className="animate-spin text-ink" />
            ) : playing ? (
              <Pause size={16} className="text-ink" />
            ) : (
              <Play size={16} className="text-ink" />
            )}
          </span>
        </button>

        <button
          type="button"
          onClick={() => openLinkOut(parsed.url)}
          className="min-w-0 flex-1 text-start"
        >
          <span className="block truncate text-[13px] font-semibold text-ink">{title}</span>
          <span className="block truncate text-[11.5px] text-ink-subtle">
            {meta?.author || (parsed.provider === "youtube" ? "YouTube" : "SoundCloud")}
          </span>
        </button>

        <div
          className="relative shrink-0"
          onPointerEnter={() => setBarOpen(true)}
          onPointerLeave={() => setBarOpen(false)}
        >
          <button
            type="button"
            onClick={() => setMuted((m) => !m)}
            aria-label={muted ? t("Unmute") : t("Mute")}
            className="grid h-9 w-9 place-items-center rounded-full text-ink-subtle transition-colors hover:bg-elevated hover:text-ink"
          >
            {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </button>
          <div
            className={`absolute bottom-full left-1/2 z-20 flex -translate-x-1/2 flex-col items-center rounded-lg border border-edge-soft bg-canvas/95 px-2.5 py-3 shadow-[0_18px_40px_-12px_rgba(0,0,0,0.75)] backdrop-blur-md transition-[opacity,transform] duration-150 ${
              barOpen ? "scale-100 opacity-100" : "pointer-events-none scale-90 opacity-0"
            }`}
          >
            <VolumeBar value={muted ? 0 : volume} onChange={onVolumeDrag} />
            <span className="mt-1.5 font-mono text-[11px] tabular-nums text-ink-subtle">
              {muted ? 0 : volume}
            </span>
          </div>
        </div>
      </div>

      {failed && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-edge-soft/60 px-3 py-2 text-[11px] text-ink-subtle">
          <span>{t("This stream could not be played.")}</span>
          <div className="flex shrink-0 items-center gap-3">
            <button
              type="button"
              onClick={retry}
              className="inline-flex items-center gap-1 text-ink-subtle transition-colors hover:text-ink"
            >
              <RefreshCw size={11} />
              {t("Try again")}
            </button>
            <button
              type="button"
              onClick={() => openLinkOut(parsed.url)}
              className="text-ink-subtle transition-colors hover:text-ink"
            >
              {t("Open in browser")}
            </button>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => {
          if (mode === "auto") {
            setStarted(false);
            setPlaying(false);
            update({ profileAudio: "click" });
            return;
          }
          update({ profileAudio: "auto" });
          startPlay();
        }}
        className="w-full border-t border-edge-soft/60 px-3 py-1.5 text-[11px] text-ink-subtle transition-colors hover:text-ink"
      >
        {mode === "auto" ? t("Mute all profile songs") : t("Autoplay profile songs")}
      </button>

      {!useNative && started && (
        <iframe
          ref={frameRef}
          src={embed?.embedSrc}
          title={title}
          allow="autoplay; encrypted-media"
          referrerPolicy="strict-origin-when-cross-origin"
          onLoad={() => {
            sendAudioCommand(frameRef.current, parsed.provider, muted ? "mute" : "unmute");
            if (!muted) sendAudioVolume(frameRef.current, parsed.provider, volume);
            if (!playing) sendAudioCommand(frameRef.current, parsed.provider, "pause");
          }}
          aria-hidden
          tabIndex={-1}
          className="pointer-events-none absolute h-px w-px opacity-0"
        />
      )}
    </section>
  );
}

function VolumeBar({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [wide, setWide] = useState(false);

  const pick = (clientY: number) => {
    const r = trackRef.current?.getBoundingClientRect();
    if (!r || r.height === 0) return;
    const f = Math.max(0, Math.min(1, 1 - (clientY - r.top) / r.height));
    onChange(Math.round(f * 100));
  };

  return (
    <div
      ref={trackRef}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        pick(e.clientY);
      }}
      onPointerMove={(e) => {
        if (e.buttons === 1) pick(e.clientY);
      }}
      onWheel={(e) => onChange(Math.max(0, Math.min(100, value + (e.deltaY < 0 ? 5 : -5))))}
      onPointerEnter={() => setWide(true)}
      onPointerLeave={() => setWide(false)}
      className="relative flex h-28 w-6 cursor-pointer touch-none items-stretch justify-center"
    >
      <div
        className="relative self-stretch rounded-full bg-ink/25 transition-[width] duration-150 ease-out"
        style={{ width: wide ? "10px" : "5px" }}
      >
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 rounded-full bg-ink"
          style={{ height: value + "%" }}
        />
        <div
          className="pointer-events-none absolute left-1/2 -translate-x-1/2 translate-y-1/2 rounded-full bg-ink shadow-[0_2px_6px_rgba(0,0,0,0.5)] transition-[width,height] duration-150 ease-out"
          style={{
            width: wide ? "15px" : "11px",
            height: wide ? "15px" : "11px",
            bottom: value + "%",
          }}
        />
      </div>
    </div>
  );
}
