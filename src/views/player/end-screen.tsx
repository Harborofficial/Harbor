import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Meta } from "@/lib/cinemeta";
import { meta as fetchCinemetaMeta, narrowMediaType } from "@/lib/cinemeta";
import { useT } from "@/lib/i18n";
import { usePlaybackPosition } from "@/lib/player/playback-clock";
import { cinemetaDetails } from "@/lib/providers/cinemeta-details";
import { tmdbDetails, type TmdbDetail } from "@/lib/providers/tmdb/tmdb-details";
import type { PlayerSrc } from "@/lib/view";
import { effectiveTmdbLanguage } from "@/lib/providers/tmdb/tmdb-client";
import { endScreenArt as hiRes } from "@/lib/player/end-screen-art";

export type EndScreenMode = "full" | "shrink";

const MINI_BOTTOM = 56;
const MINI_GAP = 32;
const MINI_MIN = 340;
const MINI_MAX = 560;
const MINI_RATIO = 9 / 16;

type Rect = { left: number; top: number; width: number; height: number };
type Layout = {
  scale: number;
  gutter: number;
  gap: number;
  perPage: number;
  cardW: number;
  viewportW: number;
  miniH: number;
};

const detailCache = new Map<string, TmdbDetail | null>();

function useFocusedDetail(meta: Meta | null, tmdbKey: string | null): TmdbDetail | null {
  const [detail, setDetail] = useState<TmdbDetail | null>(null);
  const id = meta?.id ?? null;
  const language = effectiveTmdbLanguage() || "en";
  useEffect(() => {
    if (!meta || !id) {
      setDetail(null);
      return;
    }
    const cacheKey = `${language}:${id}`;
    const cached = detailCache.get(cacheKey);
    if (cached !== undefined) {
      setDetail(cached);
      return;
    }
    let alive = true;
    const timer = window.setTimeout(() => {
      void (async () => {
        let found = tmdbKey
          ? ((await tmdbDetails(tmdbKey, meta).catch(() => null)) ??
            (await cinemetaDetails(meta).catch(() => null)))
          : await cinemetaDetails(meta).catch(() => null);
        if (found && !found.overview.trim() && tmdbKey && language.split("-")[0] !== "en") {
          const english = await tmdbDetails(tmdbKey, meta, "en-US").catch(() => null);
          if (english?.overview.trim()) found = { ...found, overview: english.overview };
        }
        if (found && !found.overview.trim()) {
          const full = await fetchCinemetaMeta(narrowMediaType(meta.type), meta.id).catch(
            () => null,
          );
          if (full?.description) found = { ...found, overview: full.description };
        }
        detailCache.set(cacheKey, found);
        if (alive) setDetail(found);
      })();
    }, 160);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
    // `meta` is read for its id only; a new object with the same id must not refetch.
  }, [id, tmdbKey, language]);
  return detail;
}

function roundedHole(x: number, y: number, w: number, h: number, r: number): string {
  return `M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}V${y + h - r}A${r} ${r} 0 0 1 ${x + w - r} ${y + h}H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`;
}

function yearOf(meta: Meta): string {
  const raw = meta.releaseInfo ?? meta.releaseDate ?? "";
  const year = String(raw).slice(0, 4);
  return /^\d{4}$/.test(year) ? year : "";
}

function formatTime(totalSec: number): string {
  const sec = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

/** Only this line re-renders with the playback clock. */
function TimeLeft({ durationSec }: { durationSec: number }) {
  const t = useT();
  const position = usePlaybackPosition();
  if (durationSec <= 0) return null;
  return (
    <span>
      {formatTime(durationSec - position)} {t("left")}
    </span>
  );
}

function MetaThumb({ meta, className }: { meta: Meta; className?: string }) {
  const src = hiRes(meta.background ?? meta.poster);
  return (
    <span className={`relative block overflow-hidden bg-elevated ${className ?? ""}`}>
      {src && (
        <img src={src} alt="" aria-hidden decoding="async" className="h-full w-full object-cover" />
      )}
    </span>
  );
}

function MiniControls({
  paused,
  durationSec,
  volume,
  muted,
  onTogglePlay,
  onVolume,
  onToggleMute,
}: {
  paused: boolean;
  durationSec: number;
  volume: number;
  muted: boolean;
  onTogglePlay: () => void;
  onVolume: (value: number) => void;
  onToggleMute: () => void;
}) {
  const t = useT();
  const position = usePlaybackPosition();
  const pct = durationSec > 0 ? Math.max(0, Math.min(100, (position / durationSec) * 100)) : 0;
  return (
    <div className="pointer-events-auto absolute inset-x-0 bottom-0 flex items-center gap-2 bg-[linear-gradient(180deg,rgba(0,0,0,0)_0%,rgba(0,0,0,0.78)_100%)] px-2.5 pb-1.5 pt-5">
      <button
        type="button"
        onClick={onTogglePlay}
        aria-label={paused ? t("Play") : t("Pause")}
        className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-white/90 hover:text-white"
      >
        {paused ? (
          <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
            <path d="M8 5v14l11-7z" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
            <path d="M7 5h4v14H7zM13 5h4v14h-4z" />
          </svg>
        )}
      </button>
      <span className="relative h-1 flex-1 overflow-hidden rounded-full bg-white/25">
        <span
          className="absolute inset-y-0 left-0 rounded-full bg-white"
          style={{ width: `${pct}%` }}
        />
      </span>
      <button
        type="button"
        onClick={onToggleMute}
        aria-label={muted ? t("Unmute") : t("Mute")}
        className="grid h-7 w-7 shrink-0 place-items-center text-white/90 hover:text-white"
      >
        <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
          <path d="M4 9v6h4l5 4V5L8 9H4z" />
          {muted ? (
            <path d="M16 9l4 6M20 9l-4 6" stroke="currentColor" strokeWidth="1.8" fill="none" />
          ) : (
            <path d="M16 8a5 5 0 010 8" stroke="currentColor" strokeWidth="1.8" fill="none" />
          )}
        </svg>
      </button>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={muted ? 0 : volume}
        onChange={(e) => onVolume(Number(e.target.value))}
        aria-label={t("Volume")}
        className="h-1 w-[74px] shrink-0 cursor-pointer"
        style={{ accentColor: "var(--color-accent)" }}
      />
    </div>
  );
}

export function EndScreen({
  mode,
  src,
  items,
  focused,
  countdown,
  countdownTotal,
  tmdbKey,
  paused,
  durationSec,
  volume,
  muted,
  onFocus,
  onPlay,
  onInfo,
  onInteract,
  onClose,
  onDismiss,
  onTogglePlay,
  onVolume,
  onToggleMute,
}: {
  mode: EndScreenMode;
  src: PlayerSrc;
  items: Meta[];
  focused: number;
  countdown: number | null;
  countdownTotal: number;
  tmdbKey: string | null;
  paused: boolean;
  durationSec: number;
  volume: number;
  muted: boolean;
  onFocus: (index: number) => void;
  onPlay: (meta: Meta) => void;
  onInfo: (meta: Meta) => void;
  onInteract: () => void;
  onClose: () => void;
  onDismiss: () => void;
  onTogglePlay: () => void;
  onVolume: (value: number) => void;
  onToggleMute: () => void;
}) {
  const t = useT();
  const rootRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<Layout>({
    scale: 1,
    gutter: 32,
    gap: 14,
    perPage: 5,
    cardW: 320,
    viewportW: 1920,
    miniH: 203,
  });
  const [mini, setMini] = useState<Rect | null>(null);
  const [expandBottom, setExpandBottom] = useState<number | null>(null);

  const current = items[focused] ?? null;
  const detail = useFocusedDetail(current, tmdbKey);
  const playingDetail = useFocusedDetail(src.meta, tmdbKey);
  // A portrait poster stretched across the page reads as a broken backdrop, so
  // the page only ever uses a real backdrop and falls back to the film playing.
  const backdrop = hiRes(current?.background ?? detail?.backdrop ?? src.meta.background);
  const expandedArt = hiRes(current?.background ?? detail?.backdrop ?? current?.poster);
  const poster = hiRes(src.meta.poster);
  const [zone, setZone] = useState<"cards" | "expand" | "mini" | "actions">("cards");
  const [actionIndex, setActionIndex] = useState(0);
  const [expandAction, setExpandAction] = useState(0);
  const actions: Array<"dismiss" | "close"> = mode === "shrink" ? ["dismiss", "close"] : ["close"];

  const { scale, gutter, gap, perPage, cardW, viewportW, miniH } = layout;
  const stripBottom = MINI_BOTTOM + miniH + MINI_GAP;
  const pages = Math.max(1, Math.ceil(items.length / perPage));
  const page = Math.floor(focused / perPage);
  const pageStart = page * perPage;
  const visible = items.slice(pageStart, pageStart + perPage);
  const indexInPage = focused - pageStart;

  useEffect(() => {
    // Decode every recommendation upfront so the first page change does not
    // stall on fresh images (the first transition was the only slow one).
    for (const item of items) {
      const url = hiRes(item.background ?? item.poster);
      if (!url) continue;
      const image = new Image();
      image.decoding = "async";
      image.src = url;
    }
  }, [items]);

  /* Cards are sized and paginated so the row always ends with a whole card. */
  useLayoutEffect(() => {
    const update = () => {
      const viewportWNow = window.innerWidth;
      const scaleNow = Math.max(0.85, Math.min(1.6, viewportWNow / 1920));
      const gutterNow = Math.round(32 * scaleNow);
      const gapNow = Math.round(14 * scaleNow);
      const minCardNow = Math.round(280 * scaleNow);
      const available = viewportWNow - gutterNow * 2;
      const perPageNow = Math.max(
        3,
        Math.min(6, Math.floor((available + gapNow) / (minCardNow + gapNow))),
      );
      const cardWNow = Math.floor((available - gapNow * (perPageNow - 1)) / perPageNow);
      const miniWNow = Math.min(MINI_MAX, Math.max(MINI_MIN, viewportWNow * 0.18));
      setLayout({
        scale: scaleNow,
        gutter: gutterNow,
        gap: gapNow,
        perPage: perPageNow,
        cardW: cardWNow,
        viewportW: viewportWNow,
        miniH: Math.round(miniWNow * MINI_RATIO),
      });
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  /* The mini player is the real mount. Measure it so the page cuts exactly the
     same hole and the click target/controls sit on top of the picture. */
  useLayoutEffect(() => {
    if (mode !== "shrink") {
      setMini(null);
      return;
    }
    const mount = document.querySelector<HTMLElement>("[data-player-video-mount]");
    const root = rootRef.current;
    if (!mount || !root) return;
    const read = () => {
      const m = mount.getBoundingClientRect();
      const r = root.getBoundingClientRect();
      setMini({ left: m.left - r.left, top: m.top - r.top, width: m.width, height: m.height });
    };
    read();
    const observer = new ResizeObserver(read);
    observer.observe(mount);
    window.addEventListener("resize", read);
    // The mount animates its position as well as its size, so follow it for
    // the duration of the shrink.
    const started = performance.now();
    let frame = 0;
    const follow = () => {
      read();
      if (performance.now() - started < 800) frame = requestAnimationFrame(follow);
    };
    frame = requestAnimationFrame(follow);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", read);
      cancelAnimationFrame(frame);
    };
  }, [mode]);

  const clip = mini
    ? `path(evenodd, "M0 0H${viewportW}V${window.innerHeight}H0Z ${roundedHole(mini.left, mini.top, mini.width, mini.height, 14)}")`
    : undefined;

  /* The expanded card starts on the focused tile's own left edge. Only a tile
     whose card would leave the screen shifts left to stay inside the row. */
  useLayoutEffect(() => {
    const strip = stripRef.current;
    if (!strip) {
      setExpandBottom(null);
      return;
    }
    const update = () => {
      setExpandBottom(strip.getBoundingClientRect().top);
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [cardW, perPage, mode, items.length, stripBottom]);

  const step = (delta: number) => {
    if (items.length === 0) return;
    onInteract();
    onFocus(Math.max(0, Math.min(items.length - 1, focused + delta)));
  };

  useEffect(() => {
    setZone("cards");
    setActionIndex(0);
    setExpandAction(0);
  }, [mode, items.length]);

  useEffect(() => {
    setExpandAction(0);
  }, [focused]);

  const showExpand = zone === "cards" || zone === "expand";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const key = e.key;
      if (
        key !== "ArrowLeft" &&
        key !== "ArrowRight" &&
        key !== "ArrowUp" &&
        key !== "ArrowDown" &&
        key !== "Enter" &&
        key !== " " &&
        key !== "Escape"
      ) {
        return;
      }
      e.preventDefault();
      e.stopImmediatePropagation();

      if (key === "Escape") {
        if (zone !== "cards") {
          setZone("cards");
          return;
        }
        if (mode === "shrink") onDismiss();
        else onClose();
        return;
      }

      if (zone === "cards") {
        if (key === "ArrowLeft") step(-1);
        else if (key === "ArrowRight") step(1);
        else if (key === "ArrowUp") {
          if (!current) return;
          onInteract();
          setZone("expand");
          setExpandAction(0);
        } else if (key === "ArrowDown") {
          onInteract();
          if (mode === "shrink") setZone("mini");
          else {
            setZone("actions");
            setActionIndex(0);
          }
        } else if (key === "Enter" || key === " ") {
          onInteract();
          if (current) onPlay(current);
        }
        return;
      }

      // The expanded card owns Play / More info.
      if (zone === "expand") {
        if (key === "ArrowLeft") setExpandAction(0);
        else if (key === "ArrowRight") setExpandAction(1);
        else if (key === "ArrowDown") setZone("cards");
        else if (key === "Enter" || key === " ") {
          if (!current) return;
          onInteract();
          if (expandAction === 0) onPlay(current);
          else onInfo(current);
        }
        return;
      }

      if (zone === "mini") {
        if (key === "Enter" || key === " ") {
          onInteract();
          onDismiss();
        } else if (key === "ArrowRight") {
          onInteract();
          setZone("actions");
          setActionIndex(0);
        } else if (key === "ArrowUp" || key === "ArrowLeft") {
          setZone("cards");
        }
        return;
      }

      // Actions row.
      if (key === "Enter" || key === " ") {
        onInteract();
        if (actions[actionIndex] === "dismiss") onDismiss();
        else onClose();
      } else if (key === "ArrowRight") {
        setActionIndex((index) => Math.min(actions.length - 1, index + 1));
      } else if (key === "ArrowLeft") {
        if (actionIndex > 0) setActionIndex(actionIndex - 1);
        else if (mode === "shrink") setZone("mini");
        else setZone("cards");
      } else if (key === "ArrowUp") {
        setZone("cards");
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  const year = detail?.year ?? yearOf(current ?? src.meta);
  const genres = detail?.genres ?? current?.genres ?? [];
  const runtime = detail?.runtime ?? current?.runtime;
  const rating = detail?.rating ?? current?.imdbRating;
  const ratingSource = detail?.ratingSource === "tmdb" ? "TMDB" : "IMDb";
  const playingRating = playingDetail?.rating ?? src.meta.imdbRating;
  const playingSource = playingDetail?.ratingSource === "tmdb" ? "TMDB" : "IMDb";
  const overview = detail?.overview?.trim() || current?.description?.trim();
  const ring = countdown != null && countdownTotal > 0 ? countdown / countdownTotal : 0;

  const expandW = Math.min(Math.round(620 * scale), cardW * 2);
  const expandLeft = Math.max(
    gutter,
    Math.min(gutter + indexInPage * (cardW + gap), viewportW - gutter - expandW),
  );
  const nowGenres = playingDetail?.genres ?? src.meta.genres ?? [];
  const nowYear = playingDetail?.year ?? yearOf(src.meta);
  const nowLine = [nowYear, ...nowGenres.slice(0, 2)].filter(Boolean).join(" · ");

  return (
    <div
      ref={rootRef}
      className="animate-fade-in absolute inset-0 z-[130] select-none text-ink"
      role="dialog"
      aria-modal
    >
      {/* Focus-driven backdrop; the mini rect is cut out so the film stays visible. */}
      <div className="absolute inset-0 bg-canvas" style={{ clipPath: clip }}>
        {backdrop && (
          <img
            key={backdrop}
            src={backdrop}
            alt=""
            aria-hidden
            className="animate-fade-in absolute inset-0 h-full w-full object-cover object-center opacity-55"
            decoding="async"
          />
        )}
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(4,5,9,0.62)_0%,rgba(4,5,9,0.22)_26%,rgba(4,5,9,0.12)_45%,rgba(4,5,9,0.85)_100%)]" />
      </div>

      <div
        className="absolute flex items-baseline gap-3"
        style={{ left: gutter, right: gutter, top: Math.round(18 * scale) }}
      >
        <h2
          className="font-bold tracking-tight"
          style={{ fontSize: `clamp(28px, ${1.45 * scale}vw, 44px)` }}
        >
          {t("More like this")}
        </h2>
        {pages > 1 && (
          <span
            className="ms-auto tracking-[0.06em] text-ink-muted"
            style={{ fontSize: `clamp(12px, ${0.7 * scale}vw, 18px)` }}
          >
            {page + 1} / {pages}
          </span>
        )}
      </div>

      {/* Expanded card for the focused tile */}
      {current && expandBottom != null && showExpand && (
        <div
          className="absolute z-20 overflow-hidden rounded-[14px] border-2 border-white/85 bg-[#0d0f17] shadow-[0_0_0_4px_rgba(111,140,255,0.28),0_34px_70px_rgba(0,0,0,0.75)] transition-[left,bottom] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
          style={{
            left: expandLeft,
            bottom: window.innerHeight - expandBottom + 10,
            width: expandW,
          }}
        >
          <div className="relative aspect-[16/7] overflow-hidden bg-elevated">
            {expandedArt && (
              <img
                src={expandedArt}
                alt=""
                aria-hidden
                className="h-full w-full object-cover object-center"
              />
            )}
            <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(13,15,23,0)_40%,rgba(13,15,23,0.95)_100%)]" />
          </div>
          <div className="relative -mt-6 px-5 pb-5">
            <div className="flex items-start justify-between gap-3">
              <h3
                className="font-semibold leading-tight"
                style={{ fontSize: `clamp(22px, ${1.3 * scale}vw, 40px)` }}
              >
                {current.name}
              </h3>
              {rating && (
                <span className="flex shrink-0 items-center gap-1.5">
                  <span className="rounded-[3px] bg-amber-400 px-1.5 py-0.5 text-[10px] font-black leading-none text-black">
                    {ratingSource}
                  </span>
                  <span
                    className="font-bold text-amber-300"
                    style={{ fontSize: `clamp(13px, ${0.72 * scale}vw, 19px)` }}
                  >
                    {rating}
                  </span>
                </span>
              )}
            </div>
            <div
              className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-ink-muted"
              style={{ fontSize: `clamp(12.5px, ${0.7 * scale}vw, 18px)` }}
            >
              {year && <span>{year}</span>}
              {runtime && <span>· {runtime}</span>}
              {genres.length > 0 && <span>· {genres.slice(0, 3).join(", ")}</span>}
            </div>
            {overview ? (
              <p
                className="mt-3 line-clamp-2 leading-relaxed text-ink-muted"
                style={{ fontSize: `clamp(12.5px, ${0.7 * scale}vw, 18px)` }}
              >
                {overview}
              </p>
            ) : (
              <p className="mt-3 text-[13px] italic text-ink-subtle">{t("No synopsis yet.")}</p>
            )}
            <div className="mt-4 flex gap-2.5">
              <button
                type="button"
                onClick={() => {
                  onInteract();
                  onPlay(current);
                }}
                className={`flex h-9 items-center gap-2 rounded-lg bg-accent px-4 font-semibold text-canvas transition-[box-shadow] duration-200 ${
                  zone === "expand" && expandAction === 0
                    ? "shadow-[0_0_0_3px_rgba(255,255,255,0.85)]"
                    : ""
                }`}
                style={{ fontSize: `clamp(13px, ${0.72 * scale}vw, 19px)` }}
              >
                {t("Play")}
              </button>
              <button
                type="button"
                onClick={() => {
                  onInteract();
                  onInfo(current);
                }}
                className={`flex h-9 items-center rounded-lg border px-4 font-semibold text-ink transition-[box-shadow,border-color] duration-200 ${
                  zone === "expand" && expandAction === 1
                    ? "border-accent bg-white/10 shadow-[0_0_0_3px_rgba(111,140,255,0.5)]"
                    : "border-white/15 bg-white/5"
                }`}
                style={{ fontSize: `clamp(13px, ${0.72 * scale}vw, 19px)` }}
              >
                {t("More info")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Whole cards only: the page is sized to fit the row exactly. */}
      <div
        ref={stripRef}
        className="absolute z-10 flex"
        style={{ left: gutter, right: gutter, bottom: stripBottom, gap }}
      >
        {visible.map((meta, indexInPageNow) => {
          const index = pageStart + indexInPageNow;
          return (
            <button
              key={meta.id}
              type="button"
              onMouseEnter={() => {
                onInteract();
                setZone("cards");
                onFocus(index);
              }}
              onClick={() => {
                onInteract();
                setZone("cards");
                onFocus(index);
                onPlay(meta);
              }}
              className={`group shrink-0 overflow-hidden rounded-[10px] border-2 text-start transition-[box-shadow,border-color] duration-200 ${
                index === focused
                  ? zone === "cards"
                    ? "border-white shadow-[0_0_0_3px_rgba(111,140,255,0.45)]"
                    : "border-white/50 shadow-none"
                  : "border-transparent"
              }`}
              style={{ width: cardW }}
            >
              <MetaThumb meta={meta} className="aspect-video" />
              <span
                className="block truncate bg-[#12141c] px-3 py-2 font-semibold text-ink"
                style={{ fontSize: `clamp(13px, ${0.76 * scale}vw, 20px)` }}
              >
                {meta.name}
              </span>
            </button>
          );
        })}
      </div>

      {/* The film itself: click it to put it back. */}
      {mode === "shrink" && mini && (
        <>
          <button
            type="button"
            onMouseEnter={() => setZone("mini")}
            onClick={() => {
              onInteract();
              onDismiss();
            }}
            aria-label={t("Return to playback")}
            className="absolute z-10 cursor-pointer rounded-[14px]"
            style={{ left: mini.left, top: mini.top, width: mini.width, height: mini.height }}
          />
          <div
            className="absolute z-10 text-start"
            style={{ left: mini.left + mini.width + 24, bottom: MINI_BOTTOM + 16 }}
          >
            <div
              className="font-semibold uppercase tracking-[0.14em] text-ink-muted"
              style={{ fontSize: `clamp(11px, ${0.6 * scale}vw, 15px)` }}
            >
              {t("Now playing")}
            </div>
            <div
              className="mt-1.5 font-bold"
              style={{ fontSize: `clamp(18px, ${1.15 * scale}vw, 32px)` }}
            >
              {src.meta.name}
            </div>
            <div
              className="mt-1 text-ink-muted"
              style={{ fontSize: `clamp(12.5px, ${0.7 * scale}vw, 18px)` }}
            >
              {nowLine}
            </div>
            <div
              className="mt-1 flex flex-wrap items-center gap-x-2 text-ink-muted"
              style={{ fontSize: `clamp(12.5px, ${0.7 * scale}vw, 18px)` }}
            >
              <TimeLeft durationSec={durationSec} />
              {playingRating && (
                <span>
                  · {playingSource} {playingRating}
                </span>
              )}
            </div>
          </div>
          <div
            className="pointer-events-none absolute z-20"
            style={{ left: mini.left, top: mini.top, width: mini.width, height: mini.height }}
          >
            <div
              className={`pointer-events-none absolute inset-0 overflow-hidden rounded-[14px] border transition-[box-shadow,border-color] duration-200 ${
                zone === "mini"
                  ? "border-accent shadow-[0_0_0_4px_rgba(111,140,255,0.45)]"
                  : "border-white/15 shadow-[0_22px_48px_rgba(0,0,0,0.72)]"
              }`}
            >
              <MiniControls
                paused={paused}
                durationSec={durationSec}
                volume={volume}
                muted={muted}
                onTogglePlay={() => {
                  onInteract();
                  onTogglePlay();
                }}
                onVolume={(value) => {
                  onInteract();
                  onVolume(value);
                }}
                onToggleMute={() => {
                  onInteract();
                  onToggleMute();
                }}
              />
            </div>
          </div>
        </>
      )}

      {/* Finished title in the full-screen layout */}
      {mode === "full" && (
        <div className="absolute z-10 flex items-end gap-6" style={{ left: gutter, bottom: 44 }}>
          {poster && (
            <img
              src={poster}
              alt=""
              aria-hidden
              className="h-[168px] w-[112px] rounded-lg object-cover shadow-[0_20px_44px_rgba(0,0,0,0.6)]"
            />
          )}
          <div>
            <div
              className="font-semibold uppercase tracking-[0.14em] text-ink-muted"
              style={{ fontSize: `clamp(11px, ${0.6 * scale}vw, 15px)` }}
            >
              {t("You just finished")}
            </div>
            <div
              className="mt-1.5 font-bold"
              style={{ fontSize: `clamp(20px, ${1.35 * scale}vw, 38px)` }}
            >
              {src.meta.name}
            </div>
            <div
              className="mt-1 text-ink-muted"
              style={{ fontSize: `clamp(12.5px, ${0.7 * scale}vw, 18px)` }}
            >
              {nowLine}
            </div>
          </div>
        </div>
      )}

      <div
        className="absolute z-10 flex flex-col items-end gap-3"
        style={{ right: gutter, bottom: MINI_BOTTOM }}
      >
        {countdown != null && countdownTotal > 0 && (
          <div
            className="flex items-center gap-3 text-ink-muted"
            style={{ fontSize: `clamp(15px, ${0.9 * scale}vw, 24px)` }}
          >
            <span
              className="relative grid place-items-center"
              style={{ width: "clamp(44px, 2.6vw, 68px)", height: "clamp(44px, 2.6vw, 68px)" }}
            >
              <svg
                viewBox="0 0 36 36"
                className="-rotate-90"
                style={{ width: "clamp(44px, 2.6vw, 68px)", height: "clamp(44px, 2.6vw, 68px)" }}
              >
                <circle
                  cx="18"
                  cy="18"
                  r="15.9"
                  fill="none"
                  stroke="rgba(255,255,255,0.16)"
                  strokeWidth="3.4"
                />
                <circle
                  cx="18"
                  cy="18"
                  r="15.9"
                  fill="none"
                  stroke="var(--color-accent)"
                  strokeWidth="3.4"
                  strokeLinecap="round"
                  strokeDasharray={100}
                  pathLength={100}
                  style={{
                    strokeDashoffset: 100 - ring * 100,
                    transition: "stroke-dashoffset 1s linear",
                  }}
                />
              </svg>
              <span
                className="absolute font-bold text-ink"
                style={{ fontSize: `clamp(13px, ${0.78 * scale}vw, 20px)` }}
              >
                {countdown}
              </span>
            </span>
            {t("Closing in {n}s", { n: countdown })}
          </div>
        )}
        <div className="flex gap-2.5">
          {actions.map((action, index) => (
            <button
              key={action}
              type="button"
              onMouseEnter={() => {
                setZone("actions");
                setActionIndex(index);
              }}
              onClick={() => {
                onInteract();
                if (action === "dismiss") onDismiss();
                else onClose();
              }}
              className={`h-11 rounded-[10px] border px-5 font-semibold text-ink transition-[box-shadow,border-color,background-color] duration-200 ${
                zone === "actions" && actionIndex === index
                  ? "border-accent bg-accent/20 shadow-[0_0_0_3px_rgba(111,140,255,0.45)]"
                  : "border-white/15 bg-white/5"
              }`}
              style={{ fontSize: `clamp(13px, ${0.72 * scale}vw, 19px)` }}
            >
              {action === "dismiss" ? t("Keep watching") : t("Close")}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
