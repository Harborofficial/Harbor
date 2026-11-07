import { ChevronDown, Minimize, X } from "@/components/icons/music-icons";
import { pauseMusicPlayer, useMusicPlayer } from "@/lib/music/player";
import { musicVideoSessionKey } from "@/lib/music/video-surfaces";
import { musicVideoSurfaces } from "@/lib/music/video-session";
import { MusicVideoSurface } from "./music-video-surface";
import { useView } from "@/lib/view";
import { useT } from "@/lib/i18n";
import {
  closeMusicVideoMini,
  collapseMusicVideoMini,
  requestMusicWatch,
  useMusicVideoMini,
} from "@/lib/music/video-mini";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import "./music-video-mini.css";

const SIZE_KEY = "harbor.music.video-mini.size.v1";
const MIN_WIDTH = 180;
const MIN_HEIGHT = 102;
const MAX_WIDTH = 640;
const MAX_HEIGHT = 420;

function savedSize(): { width: number; height: number } {
  try {
    const raw = JSON.parse(localStorage.getItem(SIZE_KEY) ?? "null") as {
      width?: unknown;
      height?: unknown;
    } | null;
    if (raw && Number.isFinite(raw.width) && Number.isFinite(raw.height)) {
      return {
        width: Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Number(raw.width))),
        height: Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, Number(raw.height))),
      };
    }
  } catch {
    /* A missing size uses the default. */
  }
  return { width: 340, height: 191 };
}

export function MusicVideoMini() {
  const t = useT();
  const player = useMusicPlayer();
  const { setView, player: media } = useView();
  const ui = useMusicVideoMini();
  const [size, setSize] = useState(savedSize);
  const drag = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  const endDrag = useRef<(() => void) | null>(null);
  useEffect(() => () => endDrag.current?.(), []);
  const mediaKey = media
    ? `${media.meta.id}:${media.episode?.season ?? ""}:${media.episode?.episode ?? ""}`
    : "";
  // Starting a movie or series takes the screen; the music picture hides with the sound and
  // comes back afterwards unless the listener closed it.
  useEffect(() => {
    if (mediaKey) pauseMusicPlayer();
  }, [mediaKey]);
  const surfaces = useSyncExternalStore(
    musicVideoSurfaces.subscribe,
    musicVideoSurfaces.getSnapshot,
    musicVideoSurfaces.getSnapshot,
  );
  const track = player.current;
  if (
    mediaKey ||
    !ui.enabled ||
    ui.watchOpen ||
    ui.hidden ||
    !track ||
    track.mediaKind !== "video" ||
    surfaces.key !== musicVideoSessionKey(track) ||
    surfaces.status === "idle" ||
    surfaces.status === "unavailable"
  )
    return null;

  const open = () => {
    setView("music");
    requestMusicWatch(track, player.queue.length ? player.queue : [track]);
  };
  const startResize = (event: React.PointerEvent<HTMLSpanElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const start = { x: event.clientX, y: event.clientY, ...size };
    drag.current = start;
    let latest = size;
    const move = (pointer: PointerEvent) => {
      const width = Math.max(
        MIN_WIDTH,
        Math.min(window.innerWidth - 32, MAX_WIDTH, start.width + start.x - pointer.clientX),
      );
      const height = Math.max(
        MIN_HEIGHT,
        Math.min(window.innerHeight - 32, MAX_HEIGHT, start.height + start.y - pointer.clientY),
      );
      latest = { width: Math.round(width), height: Math.round(height) };
      setSize(latest);
    };
    const stop = () => {
      drag.current = null;
      endDrag.current = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      try {
        localStorage.setItem(SIZE_KEY, JSON.stringify(latest));
      } catch {
        /* The size still applies for this session. */
      }
    };
    endDrag.current = stop;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  };

  return (
    <section
      className="music-video-mini"
      data-collapsed={ui.collapsed ? "1" : undefined}
      style={ui.collapsed ? undefined : { width: size.width, height: size.height }}
      aria-label={t("music.videos.mini")}
    >
      {ui.collapsed ? (
        <button type="button" className="music-video-mini-collapsed" onClick={open}>
          <span>{track.title}</span>
          <span className="music-video-mini-collapsed-artist">{track.artist}</span>
        </button>
      ) : (
        <div
          role="button"
          tabIndex={0}
          className="music-video-mini-stage"
          aria-label={t("music.videos.watch", { title: track.title })}
          onClick={open}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              open();
            }
          }}
        >
          <MusicVideoSurface track={track} active mini />
        </div>
      )}
      {!ui.collapsed && (
        <span
          className="music-video-mini-resize"
          role="separator"
          aria-label={t("music.videos.resizeMini")}
          onPointerDown={startResize}
          onClick={(event) => event.stopPropagation()}
        />
      )}
      <div className="music-video-mini-actions">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            collapseMusicVideoMini();
          }}
          aria-label={t(ui.collapsed ? "music.videos.expand" : "music.videos.collapse")}
          title={t(ui.collapsed ? "music.videos.expand" : "music.videos.collapse")}
        >
          {ui.collapsed ? <ChevronDown size={13} /> : <Minimize size={13} />}
        </button>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            closeMusicVideoMini();
          }}
          aria-label={t("music.videos.closeMini")}
          title={t("music.videos.closeMini")}
        >
          <X size={13} />
        </button>
      </div>
    </section>
  );
}
