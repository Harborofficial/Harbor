import { useEffect, useLayoutEffect, useRef, useState, useCallback } from "react";
import { MoreHorizontal } from "lucide-react";
import { useT } from "@/lib/i18n";
import type { NavItem } from "@/chrome/nav-items";
import { useContextMenu } from "@/lib/context-menu";
import { useNavEditMode } from "@/chrome/nav-edit-mode";
import { NavEditableItem, useNavDrag } from "@/chrome/nav-edit";

export type NavOverflowEntry = {
  item: NavItem;
  label: string;
  active: boolean;
  gated: boolean;
  onSelect: () => void;
};

const ITEM_COLLAPSED_W = 40;
const MORE_COLLAPSED_W = 40;
const GAP_PX = 4;
// The capsule folds and unfolds over roughly half a second; hold the indicator past that tail.
const ISLAND_RESIZE_MS = 660;
// A press hands the indicator its spring: ignore label tracking for the length of that glide.
const PRESS_GLIDE_MS = 480;

/**
 * Calculates horizontal offset of a target element relative to an ancestor container
 * by walking up the offsetParent chain.
 *
 * Why offsetLeft rather than getBoundingClientRect?
 * offsetLeft ignores CSS transforms (e.g. scale on active/hover, entrance translates),
 * giving the un-transformed layout position required for the sliding indicator coordinate system.
 */
function getOffsetLeftRelativeTo(target: HTMLElement, container: HTMLElement): number {
  let current: HTMLElement | null = target;
  let offset = 0;
  while (current && current !== container) {
    offset += current.offsetLeft;
    current = current.offsetParent as HTMLElement | null;
  }
  return offset;
}

function shallowEqualRecords(a: Record<string, number>, b: Record<string, number>): boolean {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const k of keysA) {
    if (a[k] !== b[k]) return false;
  }
  return true;
}

export function MidnightOverflowNav({
  entries,
  activeKey,
  onNavigate,
  entranceActive = false,
}: {
  entries: NavOverflowEntry[];
  activeKey: string;
  onNavigate: (entry: NavOverflowEntry) => void;
  entranceActive?: boolean;
}) {
  const t = useT();
  const containerRef = useRef<HTMLDivElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null);

  const [labelWidths, setLabelWidths] = useState<Record<string, number>>({});
  const [moreLabelWidth, setMoreLabelWidth] = useState(48);
  const [visibleCount, setVisibleCount] = useState(entries.length);

  // Ready gate: transitions on sliding indicator enabled only after first paint
  const [isReady, setIsReady] = useState(false);

  // Dynamic tracking: disable indicator transitions while a neighbor is expanding/collapsing
  const [isExpanding, setIsExpanding] = useState(false);
  const activeTransitionsRef = useRef(0);
  const rafIdRef = useRef<number | null>(null);

  const shown = entries.slice(0, visibleCount);
  const overflow = entries.slice(visibleCount);

  // Synchronous refs for latest values
  const shownRef = useRef(shown);
  shownRef.current = shown;
  const overflowRef = useRef(overflow);
  overflowRef.current = overflow;
  const activeKeyRef = useRef(activeKey);
  activeKeyRef.current = activeKey;
  const entriesRef = useRef(entries);
  entriesRef.current = entries;

  // Widest strip budget seen while the bar spans the full width. Once the island narrows
  // to its content the live cluster width stops describing the available room.
  const budgetRef = useRef(0);

  // Active item indicator measurement
  const [indicatorStyle, setIndicatorStyle] = useState<{
    transform: string;
    width: number;
    opacity: number;
  }>({
    transform: "translateX(0px)",
    width: ITEM_COLLAPSED_W,
    opacity: 0,
  });

  // Make updateIndicator identity-stable (useCallback with [] deps reading the latest shown/overflow/activeKey from refs)
  const updateIndicator = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const curShown = shownRef.current;
    const curOverflow = overflowRef.current;
    const curActiveKey = activeKeyRef.current;

    // Check if active item is visible in primary strip or tucked inside More
    const activeShown = curShown.find(
      (e) => e.item.id === curActiveKey || e.item.view === curActiveKey || e.active,
    );
    const activeOverflow = curOverflow.find(
      (e) => e.item.id === curActiveKey || e.item.view === curActiveKey || e.active,
    );

    let activeEl: HTMLElement | null = null;
    if (activeShown) {
      activeEl = container.querySelector<HTMLElement>(
        `[data-midnight-item="${activeShown.item.id}"]`,
      );
    } else if (activeOverflow) {
      activeEl = container.querySelector<HTMLElement>('[data-midnight-more="true"]');
    }

    if (
      !activeEl ||
      !activeEl.isConnected ||
      activeEl.offsetWidth <= 0 ||
      activeEl.offsetHeight <= 0
    ) {
      setIndicatorStyle((prev) => (prev.opacity === 0 ? prev : { ...prev, opacity: 0 }));
      return;
    }

    // Physical offsetLeft and offsetWidth align with left: 0 in both LTR and RTL.
    // getOffsetLeftRelativeTo traverses through any intermediate positioned wrappers
    // (such as MidnightMoreMenu's relative wrapper or NavEditableItem's drag wrapper).
    const left = getOffsetLeftRelativeTo(activeEl, container);
    const width = activeEl.offsetWidth;
    const transform = `translateX(${left}px)`;

    setIndicatorStyle((prev) => {
      if (prev.transform === transform && prev.width === width && prev.opacity === 1) {
        return prev;
      }
      return { transform, width, opacity: 1 };
    });
  }, []);

  // The glass grows and shrinks over 480ms, and the strip slides with it: in RTL the active
  // item's offset moves the whole way through the resize. Track that resize frame by frame
  // with the spring off, otherwise the indicator glides from a stale offset and parks over
  // the logo before it finds the item again.
  const [islandResizing, setIslandResizing] = useState(false);
  useEffect(() => {
    const container = containerRef.current;
    const capsule = container?.closest<HTMLElement>("[data-midnight-island]");
    if (!container || !capsule) return;

    let frame = 0;
    let settle: number | null = null;

    const track = () => {
      updateIndicator();
      frame = requestAnimationFrame(track);
    };

    const observer = new MutationObserver(() => {
      // Receded, the bar is on its way out and the glass folds without it: there is nothing to
      // track, and a frame loop over sixteen hidden buttons would only cost the fold itself.
      if (capsule.getAttribute("data-midnight-island") === "collapsed") {
        cancelAnimationFrame(frame);
        if (settle !== null) {
          window.clearTimeout(settle);
          settle = null;
        }
        setIslandResizing(false);
        return;
      }
      setIslandResizing(true);
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(track);
      if (settle !== null) window.clearTimeout(settle);
      settle = window.setTimeout(() => {
        settle = null;
        cancelAnimationFrame(frame);
        updateIndicator();
        setIslandResizing(false);
      }, ISLAND_RESIZE_MS);
    });

    observer.observe(capsule, { attributes: true, attributeFilter: ["data-midnight-island"] });

    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      if (settle !== null) window.clearTimeout(settle);
    };
  }, [updateIndicator]);

  // Neighbours slide while a name expands, so the indicator must ride along without its
  // own transition — and regain the spring afterwards for click and keyboard moves.
  const expandTimerRef = useRef<number | null>(null);
  const markExpanding = useCallback(() => {
    setIsExpanding(true);
    if (expandTimerRef.current !== null) window.clearTimeout(expandTimerRef.current);
    expandTimerRef.current = window.setTimeout(() => {
      expandTimerRef.current = null;
      setIsExpanding(false);
    }, 430);
  }, []);

  // A press owns the next move: the neighbour slide is over, so the indicator gets its
  // spring back before the active item changes and glides to it. The label that unfolds on
  // the new item starts its own transition in the same breath, so tracking is muted until
  // the glide lands, otherwise that transition switch turns the move into a jump.
  const pressLockRef = useRef(0);
  const clearExpanding = useCallback(() => {
    if (expandTimerRef.current !== null) {
      window.clearTimeout(expandTimerRef.current);
      expandTimerRef.current = null;
    }
    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    activeTransitionsRef.current = 0;
    pressLockRef.current = performance.now();
    setIsExpanding(false);
  }, []);

  useEffect(
    () => () => {
      if (expandTimerRef.current !== null) window.clearTimeout(expandTimerRef.current);
    },
    [],
  );

  // Priority+ overflow measurement with hover slack reservation
  useLayoutEffect(() => {
    const container = containerRef.current;
    const ghost = ghostRef.current;
    if (!container || !ghost) return;

    const measure = () => {
      const labelEls = Array.from(ghost.querySelectorAll<HTMLElement>("[data-ghost-label]"));
      const moreLabelEl = ghost.querySelector<HTMLElement>("[data-ghost-more-label]");

      const measuredWidths: Record<string, number> = {};
      for (const el of labelEls) {
        const key = el.getAttribute("data-ghost-label");
        if (key) {
          // Add 2px for subpixel letter-spacing rendering
          measuredWidths[key] = Math.ceil(el.getBoundingClientRect().width) + 2;
        }
      }
      const measuredMoreW = moreLabelEl
        ? Math.ceil(moreLabelEl.getBoundingClientRect().width) + 2
        : 48;

      setLabelWidths((prev) => (shallowEqualRecords(prev, measuredWidths) ? prev : measuredWidths));
      setMoreLabelWidth((prev) => (prev === measuredMoreW ? prev : measuredMoreW));

      // The cluster gap is owned by CSS (responsive density), so read it back here
      // rather than assuming the fallback constant.
      const computed = getComputedStyle(container);
      const parsedGap = Number.parseFloat(computed.columnGap || computed.gap);
      const gap = Number.isFinite(parsedGap) ? parsedGap : GAP_PX;

      // The island narrows and widens with its own transition, and a hugging bar is only as
      // wide as the items it already shows. Treat the budget as the widest room ever seen
      // (reset on resize) so a shrunken strip never drops an item by accident.
      const liveWidth = container.clientWidth;
      budgetRef.current = Math.max(budgetRef.current, liveWidth);
      const avail = budgetRef.current;

      const currentEntries = entriesRef.current;
      const totalItems = currentEntries.length;

      if (avail <= 0 || totalItems === 0) {
        setVisibleCount((prev) => (prev === 1 ? prev : 1));
        return;
      }

      // Find largest count <= totalItems such that:
      // totalCollapsed + maxLabelSlack <= avail
      let chosen = 1;

      for (let count = totalItems; count >= 1; count--) {
        const candidateItems = currentEntries.slice(0, count);
        const hasMore = count < totalItems;

        const collapsedW = hasMore
          ? count * ITEM_COLLAPSED_W + count * gap + MORE_COLLAPSED_W
          : count * ITEM_COLLAPSED_W + (count - 1) * gap;

        // Reserve slack equal to the widest label among visible candidates (+ more button if present)
        const candidateLabels = candidateItems.map((e) => measuredWidths[e.item.id] || 0);
        if (hasMore) candidateLabels.push(measuredMoreW);
        const maxSlack = Math.max(...candidateLabels, 0);

        if (collapsedW + maxSlack <= avail) {
          chosen = count;
          break;
        }
      }

      setVisibleCount((prev) => (prev === chosen ? prev : chosen));
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(container);

    // A resize reopens the island (MidnightTopNav owns that), so a hugging strip must not
    // hand its own narrow width back as the budget in the meantime.
    const onResize = () => {
      const capsule = container.closest("[data-midnight-island]");
      if (capsule?.getAttribute("data-midnight-island") === "collapsed") return;
      budgetRef.current = 0;
      measure();
    };
    window.addEventListener("resize", onResize);

    if (typeof document !== "undefined" && document.fonts?.ready) {
      document.fonts.ready.then(measure).catch(() => {});
    }

    return () => {
      ro.disconnect();
      window.removeEventListener("resize", onResize);
    };
  }, [entries, t]);

  // Initial ready gate: enable transitions only after first paint
  useLayoutEffect(() => {
    if (!isReady) {
      const raf = requestAnimationFrame(() => setIsReady(true));
      return () => cancelAnimationFrame(raf);
    }
  }, [isReady]);

  // Subscribe ONE ResizeObserver to the cluster container and (through refs) to the active button,
  // set up once and re-targeted only when the active element actually changes; no re-subscribing on every render.
  const observedElRef = useRef<HTMLElement | null>(null);
  const roRef = useRef<ResizeObserver | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const ro = new ResizeObserver(() => {
      updateIndicator();
    });
    roRef.current = ro;
    ro.observe(container);

    if (observedElRef.current) {
      ro.observe(observedElRef.current);
    }

    return () => {
      ro.disconnect();
      roRef.current = null;
      observedElRef.current = null;
    };
  }, [updateIndicator]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const curShown = shownRef.current;
    const curOverflow = overflowRef.current;
    const curActiveKey = activeKeyRef.current;

    const activeShown = curShown.find(
      (e) => e.item.id === curActiveKey || e.item.view === curActiveKey || e.active,
    );
    const activeOverflow = curOverflow.find(
      (e) => e.item.id === curActiveKey || e.item.view === curActiveKey || e.active,
    );

    const activeEl = activeShown
      ? container.querySelector<HTMLElement>(`[data-midnight-item="${activeShown.item.id}"]`)
      : activeOverflow
        ? container.querySelector<HTMLElement>('[data-midnight-more="true"]')
        : null;

    const ro = roRef.current;
    if (observedElRef.current !== activeEl) {
      if (ro && observedElRef.current) {
        ro.unobserve(observedElRef.current);
      }
      if (ro && activeEl) {
        ro.observe(activeEl);
      }
      observedElRef.current = activeEl;
    }

    updateIndicator();
  }, [activeKey, visibleCount, labelWidths, updateIndicator]);

  // Bind the transitionrun/transitionend/transitioncancel listeners once.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const runLoop = () => {
      updateIndicator();
      if (activeTransitionsRef.current > 0) {
        rafIdRef.current = requestAnimationFrame(runLoop);
      }
    };

    const handleTransitionRun = (e: TransitionEvent) => {
      if (performance.now() - pressLockRef.current < PRESS_GLIDE_MS) return;
      if (
        e.propertyName === "max-width" &&
        (e.target as HTMLElement)?.classList.contains("midnight-item-label-wrap")
      ) {
        activeTransitionsRef.current += 1;
        if (activeTransitionsRef.current === 1) {
          setIsExpanding(true);
          if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
          rafIdRef.current = requestAnimationFrame(runLoop);
        }
      }
    };

    const handleTransitionEnd = (e: TransitionEvent) => {
      if (
        e.propertyName === "max-width" &&
        (e.target as HTMLElement)?.classList.contains("midnight-item-label-wrap")
      ) {
        activeTransitionsRef.current = Math.max(0, activeTransitionsRef.current - 1);
        if (activeTransitionsRef.current === 0) {
          if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
          updateIndicator();
          setIsExpanding(false);
        }
      }
    };

    container.addEventListener("transitionrun", handleTransitionRun);
    container.addEventListener("transitionend", handleTransitionEnd);
    container.addEventListener("transitioncancel", handleTransitionEnd);

    return () => {
      container.removeEventListener("transitionrun", handleTransitionRun);
      container.removeEventListener("transitionend", handleTransitionEnd);
      container.removeEventListener("transitioncancel", handleTransitionEnd);
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
    };
  }, [updateIndicator]);

  return (
    <div
      ref={containerRef}
      data-ready={isReady ? "true" : undefined}
      data-expanding={isExpanding || islandResizing ? "true" : undefined}
      className="midnight-nav-cluster relative flex min-w-0 flex-1 items-center"
      style={{ contain: "layout" }}
    >
      {/* Shared Active Sliding Indicator: physical left: 0 + translateX(offsetLeft) */}
      <span
        aria-hidden="true"
        className="midnight-sliding-indicator"
        style={{
          transform: indicatorStyle.transform,
          width: `${indicatorStyle.width}px`,
          opacity: indicatorStyle.opacity,
        }}
      />

      {/* Visible Primary Nav Items */}
      {shown.map((entry, index) => {
        const labelW = labelWidths[entry.item.id] || 80;
        const isActive = entry.active;

        return (
          <MidnightNavItemButton
            key={entry.item.id}
            entry={entry}
            labelWidth={labelW}
            active={isActive}
            onSelect={() => onNavigate(entry)}
            onHover={markExpanding}
            onPress={clearExpanding}
            staggerIndex={entranceActive ? index : undefined}
          />
        );
      })}

      {/* Overflow "More" Button */}
      {overflow.length > 0 && (
        <MidnightMoreMenu
          entries={overflow}
          moreLabelWidth={moreLabelWidth}
          onSelect={onNavigate}
          onHover={markExpanding}
        />
      )}

      {/* Off-screen Ghost Measurement Row */}
      <div
        ref={ghostRef}
        inert
        aria-hidden="true"
        className="pointer-events-none invisible absolute start-0 top-0 flex w-0 items-center overflow-hidden"
        style={{ gap: GAP_PX }}
      >
        {entries.map((e) => (
          <span
            key={e.item.id}
            data-ghost-label={e.item.id}
            className="midnight-item-label shrink-0 whitespace-nowrap"
            style={{ opacity: 1, transform: "none", display: "inline-block" }}
          >
            {e.label}
          </span>
        ))}
        <span
          data-ghost-more-label
          className="midnight-item-label shrink-0 whitespace-nowrap"
          style={{ opacity: 1, transform: "none", display: "inline-block" }}
        >
          {t("common.more")}
        </span>
      </div>
    </div>
  );
}

function MidnightNavItemButton({
  entry,
  labelWidth,
  active,
  onSelect,
  onHover,
  onPress,
  staggerIndex,
}: {
  entry: NavOverflowEntry;
  labelWidth: number;
  active: boolean;
  onSelect: () => void;
  onHover?: () => void;
  onPress?: () => void;
  staggerIndex?: number;
}) {
  const { open: openContextMenu } = useContextMenu();
  const editing = useNavEditMode();
  const drag = useNavDrag(entry.item.id, "horizontal");
  const [hovered, setHovered] = useState(false);

  return (
    <NavEditableItem itemId={entry.item.id}>
      <button
        type="button"
        tabIndex={0}
        onClick={() => {
          onPress?.();
          onSelect();
        }}
        onMouseEnter={() => {
          setHovered(true);
          onHover?.();
        }}
        onMouseLeave={() => {
          setHovered(false);
          onHover?.();
        }}
        onContextMenu={(e) =>
          openContextMenu(e, {
            kind: "nav",
            itemId: entry.item.id,
            view: entry.item.view,
            label: entry.label,
            onOpen: onSelect,
          })
        }
        data-midnight-item={entry.item.id}
        data-harbor-nav={entry.item.id}
        data-active={active ? "true" : undefined}
        aria-current={active ? "page" : undefined}
        aria-label={entry.label}
        data-tauri-drag-region={editing ? "false" : undefined}
        onPointerDown={drag.onPointerDown}
        data-nav-drop-id={entry.item.id}
        className={`midnight-item group/item relative flex h-10 items-center select-none rounded-full transition-colors duration-200 ${
          drag.over ? "ring-2 ring-accent" : ""
        } ${active ? "midnight-item-active text-ink" : "text-ink-muted hover:text-ink"}`}
        style={
          {
            "--midnight-label-w": `${labelWidth}px`,
            transitionDelay: staggerIndex !== undefined ? `${staggerIndex * 25}ms` : undefined,
          } as React.CSSProperties
        }
      >
        {/* Hit target icon: 40x40 container */}
        <span
          data-midnight-icon
          aria-hidden="true"
          className="relative z-[3] flex h-10 w-10 shrink-0 items-center justify-center"
        >
          {entry.item.render(Boolean(active || hovered), hovered)}
        </span>

        {/* Liquid hover-revealed label */}
        <span
          data-midnight-label-wrap
          aria-hidden="true"
          className="midnight-item-label-wrap relative z-[3]"
        >
          <span data-midnight-label className="midnight-item-label">
            {entry.label}
          </span>
        </span>
      </button>
    </NavEditableItem>
  );
}

function MidnightMoreMenu({
  entries,
  moreLabelWidth,
  onSelect,
  onHover,
}: {
  entries: NavOverflowEntry[];
  moreLabelWidth: number;
  onSelect: (entry: NavOverflowEntry) => void;
  onHover?: () => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const anyActive = entries.some((e) => e.active);

  // Outside click and Escape handlers
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
        moreButtonRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={menuRef} className="relative shrink-0">
      <button
        ref={moreButtonRef}
        type="button"
        tabIndex={0}
        onClick={() => setOpen((o) => !o)}
        onMouseEnter={onHover}
        onMouseLeave={onHover}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("common.more")}
        data-midnight-more="true"
        data-midnight-current={anyActive ? "true" : undefined}
        data-active={anyActive ? "true" : undefined}
        className={`midnight-item midnight-more-btn group/item relative flex h-10 items-center select-none rounded-full transition-colors duration-200 ${
          anyActive || open ? "midnight-item-active text-ink" : "text-ink-muted hover:text-ink"
        }`}
        style={
          {
            "--midnight-label-w": `${moreLabelWidth}px`,
          } as React.CSSProperties
        }
      >
        <span
          data-midnight-icon
          aria-hidden="true"
          className="relative z-[3] flex h-10 w-10 shrink-0 items-center justify-center"
        >
          <MoreHorizontal
            size={18}
            strokeWidth={2.2}
            className={`transition-transform duration-200 ${open ? "scale-110" : ""}`}
          />
        </span>
        <span
          data-midnight-label-wrap
          aria-hidden="true"
          className="midnight-item-label-wrap relative z-[3]"
        >
          <span data-midnight-label className="midnight-item-label">
            {t("common.more")}
          </span>
        </span>
      </button>

      {/* Overflow Glass Popover */}
      {open && (
        <div
          role="menu"
          aria-label={t("common.more")}
          data-harbor-context-layer="true"
          className="midnight-more-popover absolute start-0 top-[calc(100%+8px)] z-[70] flex min-w-[200px] flex-col overflow-hidden rounded-2xl p-1.5"
        >
          {entries.map((entry) => (
            <button
              key={entry.item.id}
              type="button"
              role="menuitem"
              data-harbor-nav={entry.item.id}
              aria-current={entry.active ? "page" : undefined}
              onClick={() => {
                onSelect(entry);
                setOpen(false);
              }}
              className={`flex h-10 items-center gap-3 rounded-xl px-3 text-start text-[13px] font-medium transition-colors ${
                entry.active
                  ? "bg-white/15 text-ink ring-1 ring-white/20"
                  : "text-ink-muted hover:bg-white/10 hover:text-ink"
              }`}
            >
              <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                {entry.item.render(entry.active)}
              </span>
              <span className="truncate">{entry.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
