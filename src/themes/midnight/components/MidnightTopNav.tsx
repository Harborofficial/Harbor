import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Monitor } from "lucide-react";
import { useView, type Frame, type View } from "@/lib/view";
import { useT } from "@/lib/i18n";
import { useSettings } from "@/lib/settings";
import { getThemeById } from "@/lib/theme";
import { useParental } from "@/lib/parental";
import { useActiveKid } from "@/lib/profiles";
import { useSearchActions } from "@/lib/search-context";
import { useBigPictureEntry } from "@/chrome/use-big-picture-entry";
import { useContextMenu } from "@/lib/context-menu";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { HarborMark } from "@/components/icons/harbor-mark";
import { Search } from "@/components/icons/search-icon";
import { NotificationCenter } from "@/components/notification-center/notification-center";
import { RecordingPill } from "@/chrome/recording-pill";
import { TogetherButton } from "@/chrome/topbar";
import { useRuntime } from "../runtime";
import { MidnightAccountMenu } from "./MidnightAccountMenu";
import { ParentalPinModal } from "@/components/parental-pin-modal";
import { close, minimize, toggleMaximize, useMaximized } from "@/lib/window";
import {
  useAvailableNavItems,
  applyNavCustomization,
  type NavItem,
  type NavItemId,
} from "@/chrome/nav-items";
import { MidnightOverflowNav, type NavOverflowEntry } from "./MidnightOverflowNav";

const IS_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const DEFAULT_MIDNIGHT_PRIORITY: NavItemId[] = [
  "home",
  "discover",
  "movies",
  "shows",
  "anime",
  "library",
];

// Session flag: runs the entrance animation once per session within Midnight
let hasEnteredOnce = false;

/**
 * Where the capsule is allowed to recede: a wall of artwork that scrolls away under it.
 *
 * A title page, the settings column, a reader, a picker and the player are read rather than
 * browsed, and a bar that slides away while they are read is noise - it is the text underneath that
 * pays for the movement. Everything not named here keeps the chrome still, so a surface Harbour
 * adds later cannot start moving it by accident.
 */
const BROWSING_KINDS: ReadonlySet<Frame["kind"]> = new Set<Frame["kind"]>([
  "home",
  "discover",
  "movies",
  "shows",
  "anime",
  "library",
  "catalogs",
  "calendar",
  "kids",
  "live",
  "sports",
  "vod",
  "games",
  "music",
  "people",
  "grid",
  "collections-hub",
  "collections",
  "collection",
  "curated-list",
  "brands",
  "award",
  "anime-award",
  "feed",
  "wrapped",
  "service",
]);

export function MidnightTopNav() {
  const { view, setView, chromeHidden, topKind } = useView();
  const t = useT();
  const { settings } = useSettings();
  const { locked, unlock, hiddenTabs } = useParental();
  const kid = useActiveKid();
  const { setOpen: setSearchOpen } = useSearchActions();
  const bigPicture = useBigPictureEntry();
  const { open: openContextMenu } = useContextMenu();
  const maxed = useMaximized();
  const reducedMotion = useReducedMotion();
  const runtime = useRuntime();

  // Island state: the capsule recedes while scrolling down and returns on any pointer
  // movement or at the top of the page. Kept local so nothing outside Midnight observes it.
  const [island, setIsland] = useState<"open" | "collapsed">("open");

  useEffect(() => {
    // The recede is the theme's own gesture and this switch turns it off: the bar then stays whole
    // over the board. No listener is armed at all, so the off state is also the cheaper one - the
    // page is not walked on every scroll event for a capsule that is never going to move.
    if (reducedMotion || !runtime.navShrink || !BROWSING_KINDS.has(topKind)) {
      setIsland("open");
      return;
    }
    // The app scrolls inside per-view containers, not the window, so the listener is
    // attached in the capture phase and tracks each container's own scrollTop.
    const tops = new WeakMap<EventTarget, number>();
    let lastTop = 0;
    let lastScrollAt = 0;
    let lastPointerAt = 0;

    const onScroll = (event: Event) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      // Only the view's own scroller is the page moving. A sheet, a dialog, a rail with a scrollbar
      // of its own or a pane of text scrolls itself, and the capsule has no business reacting to
      // that: it would slide away while the user reads what is inside it.
      const page = document.querySelector("main");
      const pageScrolled =
        target === (document.documentElement as unknown as HTMLElement) ||
        target === page ||
        (page !== null && target.contains(page));
      if (!pageScrolled) return;
      const top =
        target === (document.documentElement as unknown as HTMLElement)
          ? window.scrollY
          : target.scrollTop;
      // A container's first observed event carries no baseline. Views mount at the top,
      // so assume 0: the user's opening scroll-down is the gesture that must recede.
      const previous = tops.get(target) ?? 0;
      tops.set(target, top);
      lastTop = top;
      lastScrollAt = performance.now();
      const delta = top - previous;
      if (Math.abs(delta) < 4) return;
      if (top <= 24) {
        setIsland("open");
        return;
      }
      setIsland(delta > 0 ? "collapsed" : "open");
    };

    // A pointermove restores the island whenever the capsule has receded. Moves that land
    // while a scroll is still settling are trackpad noise, not a request to expand.
    const onPointerMove = () => {
      const now = performance.now();
      if (now - lastPointerAt < 100) return;
      lastPointerAt = now;
      if (now - lastScrollAt < 150) return;
      if (lastTop <= 24) return;
      setIsland("open");
    };

    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    return () => {
      document.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("pointermove", onPointerMove);
    };
  }, [reducedMotion, runtime.navShrink, topKind]);

  // Navigating always brings the chrome back, regardless of the scroll position.
  useEffect(() => {
    setIsland("open");
  }, [view]);

  // Entrance state: active only during initial session entrance
  const [entranceActive, setEntranceActive] = useState(() => !hasEnteredOnce && !reducedMotion);
  const [entered, setEntered] = useState(() => hasEnteredOnce || reducedMotion);

  useLayoutEffect(() => {
    // Reduced motion has no entrance to run, so the chrome is simply present. The preference can
    // resolve after the first paint, and that pass cancels the frame below before it reveals the
    // content: without this the bar would stay empty for the whole session.
    if (reducedMotion) {
      setEntranceActive(false);
      setEntered(true);
      return;
    }
    if (hasEnteredOnce) return;
    const raf = requestAnimationFrame(() => {
      hasEnteredOnce = true;
      setEntered(true);
    });
    const timer = setTimeout(() => {
      setEntranceActive(false);
    }, 600);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
  }, [reducedMotion]);

  const [pinFor, setPinFor] = useState<View | null>(null);

  const themePreset =
    settings.theme.preset !== "custom" ? getThemeById(settings.theme.preset) : null;
  const customMark = themePreset?.logo?.mark ?? null;

  // Resolve navigation items
  const rawItems = useAvailableNavItems();
  const customized = useMemo(() => {
    // A saved order can repeat an id (a drag that lands on itself, or an order merged from
    // another device), and the customization pass keeps every occurrence. Drop the repeats:
    // the same section twice in the strip reads as a doubled icon.
    const seen = new Set<NavItemId>();
    const deduped: NavItem[] = [];
    for (const item of applyNavCustomization(rawItems, settings.navCustomization)) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      deduped.push(item);
    }
    return deduped;
  }, [rawItems, settings.navCustomization]);

  // Phase 3C Primary-Set Rule:
  // When navCustomization.order is empty, use the priority order [home, discover, movies, shows, anime, library]
  // followed by the remaining items in canonical order. When customized, honor verbatim.
  const orderedCustomized = useMemo(() => {
    if (settings.navCustomization.order && settings.navCustomization.order.length > 0) {
      return customized;
    }
    const byId = new Map(customized.map((item) => [item.id, item]));
    const prioritized: NavItem[] = [];
    for (const id of DEFAULT_MIDNIGHT_PRIORITY) {
      const item = byId.get(id);
      if (item) {
        prioritized.push(item);
        byId.delete(id);
      }
    }
    for (const item of customized) {
      if (byId.has(item.id)) {
        prioritized.push(item);
      }
    }
    return prioritized;
  }, [customized, settings.navCustomization.order]);

  const items = useMemo(() => {
    return orderedCustomized.filter((item) => {
      if (kid) return item.view === "kids";
      if (item.view === "kids") return false;
      if (item.view === "settings") return false; // Handled in AccountMenu
      if (item.view === "vod" && !settings.showPlaylistsTab) return false;
      if (item.hideKey && settings.hideContent[item.hideKey]) return false;
      if (locked && item.parentalKey && hiddenTabs[item.parentalKey]) return false;
      return true;
    });
  }, [orderedCustomized, kid, settings.showPlaylistsTab, settings.hideContent, locked, hiddenTabs]);

  const navigate = (item: NavItem) => {
    if (item.pinGated && locked) {
      setPinFor(item.view);
      return;
    }
    setView(item.view);
  };

  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  const entriesKey = useMemo(() => {
    return items
      .map((item) => {
        const rawLabel = settings.navCustomization.renamed[item.id] || t(item.label);
        const active = view === item.view ? "1" : "0";
        const gated = item.pinGated && locked ? "1" : "0";
        return `${item.id}:${item.view}:${rawLabel}:${active}:${gated}`;
      })
      .join("|");
  }, [items, settings.navCustomization.renamed, t, view, locked]);

  const itemsRef = useRef(items);
  itemsRef.current = items;

  const navEntries: NavOverflowEntry[] = useMemo(() => {
    return itemsRef.current.map((item) => {
      const rawLabel = settings.navCustomization.renamed[item.id] || t(item.label);
      const active = view === item.view;
      const gated = !!item.pinGated && locked;
      return {
        item,
        label: rawLabel,
        active,
        gated,
        onSelect: () => navigateRef.current(item),
      };
    });
  }, [entriesKey]);

  // Receded, the capsule folds down to its tag, so the empty middle of the bar stops shading
  // the page. Both widths are explicit pixels: the pill grows towards its bar on open and
  // towards the tag on recede, and it is never given a width from a bar it is still holding.
  const capsuleRef = useRef<HTMLDivElement | null>(null);
  const headerRef = useRef<HTMLElement | null>(null);
  const tagRef = useRef<HTMLDivElement | null>(null);
  const [barWidth, setBarWidth] = useState(0);
  const [tagWidth, setTagWidth] = useState(0);

  useLayoutEffect(() => {
    const header = headerRef.current;
    if (!header) return;
    const measure = () => {
      const style = getComputedStyle(header);
      setBarWidth(
        Math.round(
          header.clientWidth -
            (Number.parseFloat(style.paddingLeft) || 0) -
            (Number.parseFloat(style.paddingRight) || 0),
        ),
      );
      // A new window size is a new layout to judge the capsule against; show it in full.
      setIsland("open");
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  // The tag is measured, never estimated: it is the width the pill folds to, so it reports its
  // own size. The box is watched because the name it carries changes with the language, a
  // renamed section and the font that lands after first paint.
  useLayoutEffect(() => {
    const tag = tagRef.current;
    if (!tag) return;
    // offsetWidth, never getBoundingClientRect: the tag is scaled while it fades in, and a painted
    // width would come back smaller than the box it actually needs. The pill would then be given a
    // target narrower than the tag, the tag would be clamped to that target, and every reported
    // frame would restart the fold with a slightly smaller width.
    const measure = () => setTagWidth(tag.offsetWidth);
    measure();
    const box = new ResizeObserver(measure);
    box.observe(tag);
    return () => box.disconnect();
  }, []);

  // The receded bar is out of the tab order, so the keyboard brings it back before it is needed:
  // the first Tab restores the chrome, and any focus that reaches the capsule opens it too.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Tab") setIsland("open");
    };
    const open = () => setIsland("open");
    document.addEventListener("keydown", onKeyDown);
    const capsule = capsuleRef.current;
    capsule?.addEventListener("focusin", open);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      capsule?.removeEventListener("focusin", open);
    };
  }, []);

  const openEmptyMenu = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    openContextMenu(e, { kind: "nav" });
  };

  // What the fold leaves behind: the section the app is on, named the way the strip names it.
  const current = items.find((item) => item.view === view) ?? null;
  const currentLabel = current
    ? settings.navCustomization.renamed[current.id] || t(current.label)
    : "";

  return (
    <>
      <header
        ref={headerRef}
        data-tv-top-chrome
        data-active-view={view}
        data-hidden={chromeHidden ? "true" : undefined}
        aria-hidden={chromeHidden}
        className="midnight-top-chrome fixed inset-x-0 top-0 z-[60] flex h-20 items-center px-4 pointer-events-none"
      >
        {/* Floating Liquid-Glass Capsule */}
        <div
          ref={capsuleRef}
          data-tauri-drag-region
          data-midnight-island={island}
          onContextMenu={openEmptyMenu}
          style={
            barWidth > 0
              ? {
                  width: `${Math.min(
                    island === "collapsed" && tagWidth > 0 ? tagWidth : barWidth,
                    barWidth,
                  )}px`,
                  marginInline: "auto",
                }
              : undefined
          }
          className={`midnight-top-capsule relative pointer-events-auto flex h-14 w-full items-center gap-2 rounded-full ps-3.5 pe-2 ${
            !entered ? "[translate:0_-16px]" : "[translate:none]"
          }`}
        >
          {/* Sibling A: Dedicated Glass Layer (isolated from opacity/filters on ancestors) */}
          <div
            aria-hidden="true"
            className={`midnight-top-capsule-glass ${!entered ? "opacity-0" : "opacity-100"}`}
          />

          {/* Sibling C: Capsule Content */}
          <div
            className={`midnight-top-capsule-content relative z-10 flex h-full w-full items-center gap-2 ${
              !entered ? "opacity-0" : "opacity-100"
            }`}
          >
            {/* Brand Button */}
            <button
              type="button"
              tabIndex={-1}
              data-tv-skip="true"
              onClick={() => setView("home")}
              className="flex shrink-0 items-center gap-2 px-1 text-ink transition-transform active:scale-95"
              aria-label={t("chrome.harborHome")}
            >
              {customMark ? (
                <img src={customMark} alt="" draggable={false} className="h-7 w-7 object-contain" />
              ) : (
                <HarborMark className="h-7 w-7" />
              )}
              {themePreset?.id === "crunch" && (
                <span className="font-display text-[20px] font-bold leading-none text-ink">
                  Harbor
                </span>
              )}
            </button>

            {/* Overflow Nav Cluster with Icon-Only Liquid Reveal */}
            <MidnightOverflowNav
              entries={navEntries}
              activeKey={view}
              onNavigate={(entry) => navigate(entry.item)}
              entranceActive={entranceActive}
            />

            {/* Action Cluster */}
            <div className="ms-1 flex shrink-0 items-center gap-1">
              <RecordingPill />
              <NotificationCenter />
              {view !== "live" && <TogetherButton variant="ghost" connectStyle="tab" />}
              {bigPicture.offer && (
                <IconBtn onClick={bigPicture.open} label={bigPicture.label} active={false}>
                  <Monitor size={16} strokeWidth={2.2} />
                </IconBtn>
              )}
              <IconBtn
                onClick={() => setSearchOpen(true)}
                label={t("common.search")}
                active={false}
              >
                <Search size={16} strokeWidth={2.2} />
              </IconBtn>

              <MidnightAccountMenu
                onOpenSettings={() => {
                  if (locked) {
                    setPinFor("settings");
                  } else {
                    setView("settings");
                  }
                }}
                settingsActive={view === "settings"}
              />

              {/* Frameless window controls for Windows/Linux when HybridTitleBar is off */}
              {IS_TAURI && !settings.useNativeTitleBar && !settings.hybridTitleBar && (
                <div className="ms-1 flex items-center gap-0.5">
                  <WinBtn onClick={minimize} label={t("chrome.minimize")}>
                    <path
                      d="M3 6.5h7"
                      stroke="currentColor"
                      strokeWidth="1.4"
                      strokeLinecap="round"
                    />
                  </WinBtn>
                  <WinBtn
                    onClick={() => void toggleMaximize()}
                    label={maxed ? t("chrome.restore") : t("chrome.maximize")}
                  >
                    {maxed ? (
                      <>
                        <rect
                          x="2.5"
                          y="4.5"
                          width="6"
                          height="6"
                          stroke="currentColor"
                          strokeWidth="1.2"
                          rx="0.5"
                        />
                        <path
                          d="M4.5 4.5V3a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 .5.5v5a.5.5 0 0 1-.5.5H8.5"
                          stroke="currentColor"
                          strokeWidth="1.2"
                        />
                      </>
                    ) : (
                      <rect
                        x="3"
                        y="3"
                        width="7"
                        height="7"
                        stroke="currentColor"
                        strokeWidth="1.4"
                        rx="1.2"
                      />
                    )}
                  </WinBtn>
                  <WinBtn onClick={close} label={t("common.close")} danger>
                    <path
                      d="M3.5 3.5l6 6M9.5 3.5l-6 6"
                      stroke="currentColor"
                      strokeWidth="1.4"
                      strokeLinecap="round"
                    />
                  </WinBtn>
                </div>
              )}
            </div>
          </div>

          {/* Sibling D: the tag the bar folds into. Decorative, and out of the pointer's way:
              it states where the app is while the bar is receded, and every control comes back
              the moment the pointer or the keyboard returns. */}
          <div ref={tagRef} aria-hidden="true" className="midnight-top-capsule-tag">
            {customMark ? (
              <img src={customMark} alt="" draggable={false} className="h-6 w-6 object-contain" />
            ) : (
              <HarborMark className="h-6 w-6" />
            )}
            {current && (
              <>
                <span className="midnight-top-capsule-tag-rule" />
                <span className="midnight-top-capsule-tag-current">
                  {current.render(true, false)}
                  <span className="midnight-top-capsule-tag-label">{currentLabel}</span>
                </span>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Parental PIN Gating Modal */}
      {pinFor !== null && (
        <ParentalPinModal
          mode={{
            kind: "unlock",
            onUnlock: () => {
              const target = pinFor;
              setPinFor(null);
              if (target) setView(target);
            },
            onCancel: () => setPinFor(null),
          }}
          verify={unlock}
        />
      )}
    </>
  );
}

function IconBtn({
  onClick,
  label,
  active,
  children,
}: {
  onClick: () => void;
  label: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`flex h-9 w-9 items-center justify-center rounded-full transition-colors ${
        active
          ? "bg-white/20 text-ink ring-1 ring-white/25"
          : "text-ink-muted hover:bg-white/10 hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

function WinBtn({
  onClick,
  label,
  danger = false,
  children,
}: {
  onClick: () => void;
  label: string;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`flex h-8 w-8 items-center justify-center rounded-full text-ink-muted transition-colors ${
        danger ? "hover:bg-red-500 hover:text-white" : "hover:bg-white/12 hover:text-ink"
      }`}
    >
      <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
        {children}
      </svg>
    </button>
  );
}
