import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Film } from "lucide-react";
import { useT } from "@/lib/i18n";
import { useProxiedImageSrc } from "@/lib/remote-image-proxy";
import { isGenericSeasonName } from "@/lib/season-name";
import type { PickerItem } from "./series-episodes/season-arc-picker";
import { useSeasonExplorerArtwork, type useSeasonExplorerView } from "./use-season-explorer";
import type { TvdbSeasonArtwork, TvdbSeasonDetails } from "@/lib/providers/tvdb-season-details";
import { Synopsis } from "./synopsis";
import { horizontalScrollState } from "@/lib/horizontal-scroll";
import { observeResize, observeWithin } from "@/lib/visibility";
import { useDragScroll } from "@/lib/use-drag-scroll";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { marqueeDurationMs } from "@/components/player/subtitle-menu/marquee-motion";
import "./season-explorer.css";

const SEASON_LABEL_CLASS =
  "shrink-0 rounded bg-ink/10 px-1.5 py-px text-[10.5px] font-semibold text-ink-muted";

type MeasureTitle = (element: Element, read: () => () => void) => () => void;
type PosterError = (number: number, url: string) => void;

const SeasonCardTitle = memo(function SeasonCardTitle({
  text,
  enabled,
  measureTitle,
}: {
  text: string;
  enabled: boolean;
  measureTitle: MeasureTitle;
}) {
  const viewportRef = useRef<HTMLParagraphElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [distance, setDistance] = useState(0);

  useEffect(() => {
    const viewport = viewportRef.current;
    const line = textRef.current;
    if (!enabled || !viewport || !line) return;
    let cancelMeasure: (() => void) | undefined;
    const schedule = () => {
      cancelMeasure = measureTitle(viewport, () => {
        const overflow = Math.round(Math.max(0, line.scrollWidth - viewport.clientWidth));
        const rtl = getComputedStyle(line).direction === "rtl";
        const next = overflow > 1 ? (rtl ? overflow : -overflow) : 0;
        return () => setDistance((prev) => (prev === next ? prev : next));
      });
    };
    schedule();
    const release = observeResize(viewport, schedule);
    return () => {
      cancelMeasure?.();
      release();
    };
  }, [text, enabled, measureTitle]);

  return (
    <p
      ref={viewportRef}
      className="season-explorer-title mt-3 h-6 min-w-0 overflow-hidden text-[15px] font-semibold leading-6 text-ink"
      title={text}
    >
      <span
        ref={textRef}
        dir="auto"
        className="season-explorer-title-line"
        data-overflow={distance !== 0 || undefined}
        style={
          {
            "--harbor-marquee": `${distance}px`,
            "--season-title-duration": `${Math.round(marqueeDurationMs(Math.abs(distance)) / 0.52)}ms`,
          } as React.CSSProperties
        }
      >
        {text}
      </span>
    </p>
  );
});

function SeasonPoster({
  src,
  name,
  onError,
}: {
  src?: string;
  name: string;
  onError: (src: string) => void;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => setFailed(null), [src]);
  const usable = src && src !== failed ? src : undefined;
  const cachedSrc = useProxiedImageSrc(usable, { forceProxy: true, persistent: true });
  return usable ? (
    <img
      src={cachedSrc}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => {
        setFailed(usable);
        onError(usable);
      }}
      className="h-full w-full object-cover"
    />
  ) : (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-raised p-2 text-ink-subtle">
      <Film size={22} aria-hidden />
      <span className="line-clamp-3 text-center text-[10px] font-medium">{name}</span>
    </div>
  );
}

function SeasonBackdrop({ sources }: { sources: (string | undefined)[] }) {
  const [failed, setFailed] = useState<string[]>([]);
  const src = sources.find((source) => source && !failed.includes(source));
  return src ? (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <img
        src={src}
        alt=""
        loading="lazy"
        decoding="async"
        onError={() => setFailed((previous) => [...previous, src])}
        className="absolute inset-y-0 right-0 h-full w-3/4 object-cover opacity-60"
      />
      <div className="absolute inset-0 bg-[linear-gradient(90deg,var(--color-canvas)_10%,color-mix(in_srgb,var(--color-canvas)_95%,transparent)_40%,color-mix(in_srgb,var(--color-canvas)_30%,transparent)_100%)]" />
      <div className="absolute inset-0 bg-gradient-to-t from-canvas/60 to-transparent" />
    </div>
  ) : null;
}

function titleFor(item: PickerItem) {
  return item.seasonNumber != null &&
    (item.seasonNumber === 0
      ? item.name === "Specials"
      : isGenericSeasonName(item.name, item.seasonNumber))
    ? undefined
    : item.name;
}

function labelFor(item: PickerItem) {
  return item.seasonNumber == null
    ? undefined
    : item.seasonNumber === 0
      ? "Specials"
      : `Season ${item.seasonNumber}`;
}

function episodeCount(item: PickerItem, t: ReturnType<typeof useT>) {
  return item.count === 1
    ? t("{n} episode", { n: item.count })
    : t("{n} episodes", { n: item.count });
}

function formatDate(value?: string) {
  if (!value) return undefined;
  const date = new Date(value.length <= 10 ? `${value}T00:00:00` : value);
  return Number.isNaN(date.getTime())
    ? undefined
    : date.toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

const SeasonCard = memo(function SeasonCard({
  item,
  poster,
  selected,
  nearby,
  panelId,
  onSelect,
  onPosterError,
  measureTitle,
}: {
  item: PickerItem;
  poster?: string;
  selected: boolean;
  nearby: boolean;
  panelId: string;
  onSelect: (key: string) => void;
  onPosterError: PosterError;
  measureTitle: MeasureTitle;
}) {
  const t = useT();
  const [focused, setFocused] = useState(false);
  const title = titleFor(item);
  const label = labelFor(item);
  const count = episodeCount(item, t);
  const accessibleName = [label, title, count].filter(Boolean).join(" · ");
  const rejectPoster = useCallback(
    (url: string) => {
      if (item.seasonNumber != null) onPosterError(item.seasonNumber, url);
    },
    [item.seasonNumber, onPosterError],
  );
  return (
    <button
      data-season-number={item.seasonNumber}
      type="button"
      aria-pressed={selected}
      aria-controls={panelId}
      aria-label={accessibleName}
      title={accessibleName}
      onClick={() => onSelect(item.key)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      className={`season-explorer-card flex w-[136px] shrink-0 snap-start flex-col items-stretch rounded-xl p-1 text-start transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:w-[164px] ${selected ? "bg-accent/10 text-ink ring-1 ring-accent" : "text-ink-muted hover:bg-ink/5 hover:text-ink"}`}
    >
      <div className="aspect-[2/3] w-full shrink-0 overflow-hidden rounded-lg">
        <SeasonPoster src={poster} name={item.name} onError={rejectPoster} />
      </div>
      <SeasonCardTitle
        text={title || label || item.name}
        enabled={nearby || focused}
        measureTitle={measureTitle}
      />
      {title && label && (
        <div className="mt-1 flex h-4 items-center justify-center">
          <span className={SEASON_LABEL_CLASS}>{label}</span>
        </div>
      )}
      <p className="mt-1.5 truncate text-center text-[11.5px] leading-4 text-ink-subtle">{count}</p>
    </button>
  );
});

const SelectedSeasonPanel = memo(function SelectedSeasonPanel({
  active,
  detail,
  artwork,
  poster,
  loading,
  background,
  panelId,
  direction,
  onPosterError,
}: {
  active: PickerItem;
  detail?: TvdbSeasonDetails;
  artwork?: TvdbSeasonArtwork;
  poster?: string;
  loading: boolean;
  background?: string;
  panelId: string;
  direction: number;
  onPosterError: PosterError;
}) {
  const t = useT();
  const activeKey = active.key;
  const overview = detail?.overview;
  const from = formatDate(active.from);
  const to = formatDate(active.to);
  const dates = from && to ? (from === to ? from : `${from} – ${to}`) : from || to || active.year;
  const count = episodeCount(active, t);
  const rejectPoster = useCallback(
    (url: string) => {
      if (active.seasonNumber != null) onPosterError(active.seasonNumber, url);
    },
    [active.seasonNumber, onPosterError],
  );
  return (
    <div
      id={panelId}
      aria-live="polite"
      aria-busy={loading}
      className="relative min-w-0 overflow-hidden rounded-2xl border border-edge bg-canvas shadow-[0_12px_40px_-24px_rgba(0,0,0,0.5)]"
    >
      <div key={activeKey} className="season-explorer-transition" data-direction={direction}>
        <SeasonBackdrop sources={[artwork?.background, background]} />
        <div className="relative flex min-h-[260px] items-start gap-4 p-5 sm:min-h-[316px] sm:gap-5 sm:p-6">
          <div className="aspect-[2/3] w-[104px] shrink-0 overflow-hidden rounded-xl shadow-lg sm:w-[164px]">
            <SeasonPoster src={poster} name={active.name} onError={rejectPoster} />
          </div>
          <div className="min-w-0 flex-1 py-1">
            <div className="flex items-center gap-2.5">
              <h4 className="min-w-0 text-[20px] font-semibold leading-tight tracking-tight text-ink sm:text-[24px]">
                {titleFor(active) || labelFor(active)}
              </h4>
              {titleFor(active) && labelFor(active) && (
                <span className={SEASON_LABEL_CLASS}>{labelFor(active)}</span>
              )}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px] text-ink-muted">
              <span className="inline-flex items-center gap-1.5">
                <Film size={14} aria-hidden />
                {count}
              </span>
              {dates && (
                <span className="inline-flex items-center gap-1.5">
                  <CalendarDays size={14} aria-hidden />
                  {dates}
                </span>
              )}
            </div>
            {overview ? (
              <div className="mt-4 [&_p]:whitespace-pre-line [&_p]:text-[14px]">
                <Synopsis key={activeKey} text={overview} />
              </div>
            ) : loading ? (
              <div aria-hidden className="mt-4 flex animate-pulse flex-col gap-2">
                <div className="h-2.5 w-full rounded bg-ink/10" />
                <div className="h-2.5 w-3/4 rounded bg-ink/10" />
              </div>
            ) : (
              <p className="mt-3 text-[13px] leading-relaxed text-ink-subtle">
                {t("No season synopsis available.")}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});

export function SeasonExplorer({
  data,
  activeKey,
  onSelect,
  background,
}: {
  data: ReturnType<typeof useSeasonExplorerView>;
  activeKey: string;
  onSelect: (key: string) => void;
  background?: string;
}) {
  const t = useT();
  const titleId = useId();
  const panelId = useId();
  const railRef = useRef<HTMLDivElement>(null);
  const dragScroll = useDragScroll<HTMLDivElement>({ elementRef: railRef });
  const reducedMotion = useReducedMotion();
  const [edges, setEdges] = useState({ left: false, right: false });
  const { artwork, visibleSeasons, setVisibleSeasons, onPosterError } =
    useSeasonExplorerArtwork(data);
  const { items: pickerItems, details, loading } = data;
  const items = useMemo(
    () => pickerItems.filter((item) => item.seasonNumber != null && item.seasonNumber >= 0),
    [pickerItems],
  );
  const cardMembership = useMemo(
    () => JSON.stringify(items.map((item) => [item.key, item.seasonNumber])),
    [items],
  );
  const visible = useMemo(() => new Set(visibleSeasons), [visibleSeasons]);
  const activeIndex = useMemo(
    () => items.findIndex((item) => item.key === activeKey),
    [items, activeKey],
  );
  const active = items[activeIndex];
  const [transition, setTransition] = useState({
    key: activeKey,
    index: activeIndex,
    direction: 1,
  });
  if (transition.key !== activeKey) {
    setTransition({
      key: activeKey,
      index: activeIndex,
      direction: activeIndex < transition.index ? -1 : 1,
    });
  }

  const geometry = useRef({ rtl: false, max: 0, width: 0 });
  const edgeFrame = useRef(0);
  const syncEdges = useCallback(() => {
    if (edgeFrame.current) return;
    edgeFrame.current = requestAnimationFrame(() => {
      edgeFrame.current = 0;
      const rail = railRef.current;
      if (!rail) return;
      const { rtl, max } = geometry.current;
      const position = Math.max(0, Math.min(max, rtl ? -rail.scrollLeft : rail.scrollLeft));
      const start = position > 4;
      const end = position < max - 4;
      const left = rtl ? end : start;
      const right = rtl ? start : end;
      setEdges((previous) =>
        previous.left === left && previous.right === right ? previous : { left, right },
      );
    });
  }, []);
  const refreshGeometry = useCallback(() => {
    const rail = railRef.current;
    if (!rail) return;
    const { rtl, max } = horizontalScrollState(rail);
    geometry.current = { rtl, max, width: rail.clientWidth };
    syncEdges();
  }, [syncEdges]);
  const pageSeasons = (direction: -1 | 1) => {
    railRef.current?.scrollBy({
      left: direction * geometry.current.width * 0.8,
      behavior: reducedMotion ? "auto" : "smooth",
    });
  };

  const measurements = useRef(new Map<Element, () => () => void>());
  const titleFrame = useRef(0);
  const measureTitle = useCallback<MeasureTitle>((element, read) => {
    measurements.current.set(element, read);
    if (!titleFrame.current) {
      titleFrame.current = requestAnimationFrame(() => {
        titleFrame.current = 0;
        const pending = [...measurements.current.values()];
        measurements.current.clear();
        // Read every title before updating any of their styles.
        const writes = pending.map((measure) => measure());
        writes.forEach((write) => write());
      });
    }
    return () => {
      measurements.current.delete(element);
    };
  }, []);

  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    const nearby = new Set<number>();
    let frame = 0;
    const releases = [...rail.querySelectorAll<HTMLElement>("[data-season-number]")].map((card) =>
      observeWithin(
        card,
        "0px 180px",
        (entry) => {
          const number = Number(card.dataset.seasonNumber);
          if (nearby.has(number) === entry.isIntersecting) return;
          if (entry.isIntersecting) nearby.add(number);
          else nearby.delete(number);
          if (!frame)
            frame = requestAnimationFrame(() => {
              frame = 0;
              setVisibleSeasons([...nearby]);
            });
        },
        rail,
      ),
    );
    return () => {
      cancelAnimationFrame(frame);
      releases.forEach((release) => release());
    };
  }, [cardMembership, setVisibleSeasons]);

  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    const revealSelected = (animate: boolean) => {
      const button = rail.querySelector<HTMLButtonElement>('[aria-pressed="true"]');
      if (!button) return;
      const bounds = rail.getBoundingClientRect();
      const card = button.getBoundingClientRect();
      const left =
        card.left < bounds.left
          ? card.left - bounds.left - 4
          : card.right > bounds.right
            ? card.right - bounds.right + 4
            : 0;
      if (left) rail.scrollBy({ left, behavior: animate && !reducedMotion ? "smooth" : "auto" });
    };
    revealSelected(true);
    refreshGeometry();
    let frame = 0;
    let resized = false;
    const schedule = (resize: boolean) => {
      resized ||= resize;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (resized) revealSelected(false);
        resized = false;
        refreshGeometry();
      });
    };
    const release = observeResize(rail, () => schedule(true));
    const observer = new MutationObserver(() => schedule(false));
    // Direction may be inherited from any ancestor, including the app's locale root.
    for (let node: HTMLElement | null = rail; node; node = node.parentElement) {
      observer.observe(node, { attributes: true, attributeFilter: ["dir", "class", "style"] });
    }
    return () => {
      release();
      observer.disconnect();
      cancelAnimationFrame(frame);
      cancelAnimationFrame(edgeFrame.current);
      edgeFrame.current = 0;
    };
  }, [activeKey, cardMembership, reducedMotion, refreshGeometry]);

  useEffect(
    () => () => {
      cancelAnimationFrame(titleFrame.current);
      titleFrame.current = 0;
      measurements.current.clear();
    },
    [setVisibleSeasons],
  );

  if (items.length === 0) return null;
  const posterFor = (item: PickerItem) =>
    item.seasonNumber == null ? undefined : artwork.get(item.seasonNumber)?.poster || item.poster;
  return (
    <section aria-labelledby={titleId} className="flex min-w-0 flex-col gap-3">
      <h3 id={titleId} className="text-[22px] font-medium tracking-tight text-ink">
        {t("Seasons")}
      </h3>
      <div
        className={`grid min-w-0 grid-cols-1 items-start gap-5 ${active ? "xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]" : ""}`}
      >
        <div className="relative min-w-0" data-tauri-drag-region="false">
          <div
            id={titleId + "-rail"}
            ref={dragScroll.ref}
            onScroll={syncEdges}
            {...dragScroll.handlers}
            className="season-explorer-rail flex min-w-0 cursor-grab select-none items-start snap-x snap-proximity gap-4 overflow-x-auto px-1 pb-3 pt-1 active:cursor-grabbing"
            role="group"
            aria-labelledby={titleId}
          >
            {items.map((item) => (
              <SeasonCard
                key={item.key}
                item={item}
                poster={posterFor(item)}
                selected={item.key === activeKey}
                nearby={visible.has(item.seasonNumber!)}
                panelId={panelId}
                onSelect={onSelect}
                onPosterError={onPosterError}
                measureTitle={measureTitle}
              />
            ))}
          </div>
          {edges.left && (
            <div className="season-explorer-edge season-explorer-edge-left">
              <button
                type="button"
                onClick={() => pageSeasons(-1)}
                aria-label={t("Previous seasons")}
                aria-controls={titleId + "-rail"}
                className="season-explorer-arrow"
              >
                <ChevronLeft size={22} aria-hidden />
              </button>
            </div>
          )}
          {edges.right && (
            <div className="season-explorer-edge season-explorer-edge-right">
              <button
                type="button"
                onClick={() => pageSeasons(1)}
                aria-label={t("More seasons")}
                aria-controls={titleId + "-rail"}
                className="season-explorer-arrow"
              >
                <ChevronRight size={22} aria-hidden />
              </button>
            </div>
          )}
        </div>
        {active && (
          <SelectedSeasonPanel
            active={active}
            detail={active.seasonNumber == null ? undefined : details.get(active.seasonNumber)}
            artwork={active.seasonNumber == null ? undefined : artwork.get(active.seasonNumber)}
            poster={posterFor(active)}
            loading={loading}
            background={background}
            panelId={panelId}
            direction={transition.direction}
            onPosterError={onPosterError}
          />
        )}
      </div>
    </section>
  );
}
