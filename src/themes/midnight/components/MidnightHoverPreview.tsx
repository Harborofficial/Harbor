import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Meta } from "@/lib/cinemeta";
import {
  assemblePreviewData,
  rewriteTmdbRung,
  type PreviewArt,
  type PreviewAssembly,
  type PreviewData,
} from "@/lib/hover-preview/preview-data";
import { useSettings } from "@/lib/settings";
import { useView } from "@/lib/view";
import { useSearchOpen } from "@/lib/search-context";
import { useContextMenu } from "@/lib/context-menu";
import { useT } from "@/lib/i18n";
import { usePreviewShape } from "../preview-style";
import { localizeFact, usePreviewLanguage } from "../preview-language";

const DWELL_MS = 240;
const CLOSE_MS = 220;
// Long enough for the card's longest exit transition to finish, so it is not cut off mid-fade.
const EXIT_MS = 420;
const SCROLL_QUIET_MS = 300;
// Floating panel: a fixed wide island that hangs below the hovered row.
const PANEL_W = 600;
const PANEL_RATIO = 1.95;
// Wide card: the poster itself, grown sideways. Height follows the poster so the card stays in
// its own row; the width is a multiple of the poster's so the growth reads as the same tile.
const CARD_GROW = 3;
const CARD_MIN_W = 420;
const CARD_MAX_W = 740;
// Tall enough for a two-line title, four lines of synopsis and the button on the writing's own
// side of the frame.
const CARD_MIN_H = 216;
const CARD_MAX_H = 340;
// The row's own expansion eases over 480ms on this curve. The preview moves the neighbouring
// tiles with the same hand, so the wide card reads as the tile opening rather than a layer
// lying over its row.
const PUSH_MS = 480;
const PUSH_EASE = "cubic-bezier(0.16, 1, 0.3, 1)";
const GUTTER = 12;
// The nav capsule owns the first 80px of the viewport; the preview never enters it.
const TOP_INSET = 88;
const EDGE_BAND = 0.2;
const FIBER_DEPTH = 8;

type FiberLike = { memoizedProps?: unknown; return?: FiberLike | null };

/**
 * Recovers the Meta of the card that owns an anchor element.
 *
 * The card DOM carries no identifier, so the only theme-local route to the meta is the
 * React fiber attached to the card host. The walk is bounded and returns null instead of
 * throwing: a card that cannot be read simply gets no preview.
 */
export function metaFromCard(el: HTMLElement): Meta | null {
  const anchor = el.closest<HTMLElement>("[data-preview-anchor]") ?? el;
  if (anchor.closest("[data-ghost-item],[data-ghost-more]")) return null;
  const host = anchor.closest<HTMLElement>("button") ?? anchor;
  const key = Object.keys(host).find((name) => name.startsWith("__reactFiber$"));
  if (!key) return null;
  let fiber = (host as unknown as Record<string, FiberLike | undefined>)[key] ?? null;
  for (let depth = 0; fiber && depth < FIBER_DEPTH; depth += 1) {
    const props = fiber.memoizedProps as { meta?: Meta } | null | undefined;
    const meta = props?.meta;
    if (meta && typeof meta.id === "string" && typeof meta.type === "string") return meta;
    fiber = fiber.return ?? null;
  }
  return null;
}

type Session = {
  anchor: HTMLElement;
  card: HTMLElement;
  /** The row tile that holds the card, when the card sits in a row rather than a grid. */
  cell: HTMLElement | null;
  data: PreviewData;
  assembly: PreviewAssembly;
};

type Placement = {
  left: number;
  top: number;
  width: number;
  height: number;
  origin: string;
  /** The physical edge the artwork keeps on a wide card: the one it shares with the poster. */
  artSide: "left" | "right";
};

function placePanel(rect: DOMRect, width: number, height: number, side: boolean): Placement {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let left = rect.left + rect.width / 2 - width / 2;

  if (side) {
    const toRight = rect.right + GUTTER;
    const toLeft = rect.left - GUTTER - width;
    left = toRight + width <= vw - GUTTER ? toRight : Math.max(GUTTER, toLeft);
  }
  left = Math.min(Math.max(GUTTER, left), Math.max(GUTTER, vw - width - GUTTER));

  let top = rect.bottom + GUTTER;
  if (top + height > vh - GUTTER) {
    const above = rect.top - GUTTER - height;
    top = above >= TOP_INSET ? above : Math.max(TOP_INSET, vh - height - GUTTER);
  }

  const originY = top >= rect.bottom ? 0 : height;
  const originX = Math.round(rect.left + rect.width / 2 - left);
  return { left, top, width, height, origin: `${originX}px ${originY}px`, artSide: "left" };
}

type CardPlacement = Placement & {
  /** How far the card reaches past the poster, which is what the row has to give it. */
  delta: number;
  growsRight: boolean;
};

/**
 * The wide card: the poster widens into a landscape card inside its own row.
 *
 * It keeps the poster's top and height and grows away from the nearest screen edge, so the
 * hovered tile reads as the same card turning sideways instead of a panel surfacing somewhere
 * below it. The transform origin sits on the poster, which makes the open animation travel
 * out of the artwork rather than from the middle of the card.
 */
function placeCard(rect: DOMRect): CardPlacement {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const height = Math.round(Math.min(Math.max(rect.height, CARD_MIN_H), CARD_MAX_H));
  const width = Math.round(Math.min(Math.max(rect.width * CARD_GROW, CARD_MIN_W), CARD_MAX_W));

  const centre = rect.left + rect.width / 2;
  // A poster in the leading half opens rightwards, one in the trailing half leftwards: the
  // card always grows toward the middle of the page and keeps its own outer edge in place.
  const growsRight = centre < vw / 2;
  let left = growsRight ? rect.left : rect.right - width;
  left = Math.min(Math.max(GUTTER, left), Math.max(GUTTER, vw - width - GUTTER));

  let top = Math.round(rect.top);
  top = Math.min(Math.max(TOP_INSET, top), Math.max(TOP_INSET, vh - height - GUTTER));

  // The origin rides the edge the card shares with the poster, so it opens out of the tile
  // instead of out of its middle.
  const originX = Math.round((growsRight ? rect.left : rect.right) - left);
  const originY = Math.round(rect.top + rect.height / 2 - top);

  // The artwork keeps the edge the card shares with the poster, which a clamp near a
  // screen edge can flip. The writing takes the other side, so the card opens out of the tile
  // and the tile carries on into the frame.
  const sharesLeft = Math.abs(left - rect.left) <= Math.abs(rect.right - (left + width));
  return {
    left,
    top,
    width,
    height,
    origin: `${originX}px ${originY}px`,
    artSide: sharesLeft ? "left" : "right",
    delta: Math.max(0, Math.round(width - rect.width)),
    growsRight,
  };
}

/**
 * The front card: the wide card's frame, laid over the tile it belongs to instead of inside the row.
 *
 * It keeps the card's width, height, split artwork and scale of type, and it keeps the poster's own
 * bottom edge, so the tile turns into the frame where it stands rather than a layer surfacing above
 * it. What it does not do is ask the row to make room: no neighbour is pushed, no caption is hidden
 * and no tile can slide under a motionless hand, which is what used to drop a frame that was still
 * being read on a dense grid. The frame simply stands in front of the row, wide enough to carry its
 * writing over the tiles beside it.
 */
function placeFront(rect: DOMRect): Placement {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const height = Math.round(Math.min(Math.max(rect.height, CARD_MIN_H), CARD_MAX_H));
  const width = Math.round(Math.min(Math.max(rect.width * CARD_GROW, CARD_MIN_W), CARD_MAX_W));

  const centre = rect.left + rect.width / 2;
  // The same side rule as the wide card: a poster in the leading half opens toward the middle of
  // the page, so the frame keeps its own outer edge in place and grows inward over its neighbours.
  const growsRight = centre < vw / 2;
  let left = growsRight ? rect.left : rect.right - width;
  left = Math.min(Math.max(GUTTER, left), Math.max(GUTTER, vw - width - GUTTER));

  // The frame hangs on the tile's bottom edge, so the row keeps its own baseline and any height the
  // frame has beyond the poster it takes upward, over the row above.
  let top = Math.round(rect.bottom - height);
  top = Math.min(Math.max(TOP_INSET, top), Math.max(TOP_INSET, vh - height - GUTTER));

  // The origin sits on the poster itself - the edge the frame shares with it, at its middle - so
  // the frame opens out of the tile rather than fading in over it.
  const originX = Math.round((growsRight ? rect.left : rect.right) - left);
  const originY = Math.round(rect.top + rect.height / 2 - top);

  // The artwork keeps the edge the card shares with the poster, which a clamp near a screen edge
  // can flip; the writing takes the other side so the tile carries on into the frame.
  const sharesLeft = Math.abs(left - rect.left) <= Math.abs(rect.right - (left + width));
  return {
    left,
    top,
    width,
    height,
    origin: `${originX}px ${originY}px`,
    artSide: sharesLeft ? "left" : "right",
  };
}

type RowTweak = { el: HTMLElement; transform: string; transition: string; opacity: string };

let rowTweaks: RowTweak[] = [];

/** Puts every tile the preview moved back exactly as Harbor left it. */
function restoreRow(): void {
  for (const tweak of rowTweaks) {
    tweak.el.style.transform = tweak.transform;
    tweak.el.style.transition = tweak.transition;
    tweak.el.style.opacity = tweak.opacity;
  }
  rowTweaks = [];
}

/**
 * Lets the tiles the preview moved glide back on the curve that moved them.
 *
 * The neighbours made room for the card; putting them back in a single frame while the card is
 * still fading reads as the row tearing itself shut. The inline styles are dropped once they
 * land, so Harbor's own transforms are untouched.
 */
function releaseRow(): void {
  if (rowTweaks.length === 0) return;
  const releasing = rowTweaks;
  rowTweaks = [];
  for (const tweak of releasing) {
    const { el } = tweak;
    el.style.transition = `transform ${PUSH_MS}ms ${PUSH_EASE}, opacity 200ms ease`;
    el.style.transform = tweak.transform;
    el.style.opacity = tweak.opacity;
    window.setTimeout(() => {
      // A tile pulled again before it landed keeps the place it was given.
      if (rowTweaks.some((entry) => entry.el === el)) return;
      el.style.transition = tweak.transition;
      el.style.opacity = tweak.opacity;
    }, PUSH_MS + 80);
  }
}

function tweakRow(el: HTMLElement, next: { transform?: string; opacity?: string }): void {
  rowTweaks.push({
    el,
    transform: el.style.transform,
    transition: el.style.transition,
    opacity: el.style.opacity,
  });
  el.style.transition = `transform ${PUSH_MS}ms ${PUSH_EASE}, opacity 200ms ease`;
  if (next.transform !== undefined) el.style.transform = next.transform;
  if (next.opacity !== undefined) el.style.opacity = next.opacity;
}

/** The row tile holding a card: a direct child of the horizontal track. */
function rowCellOf(card: HTMLElement): HTMLElement | null {
  const track = card.closest<HTMLElement>(".harbor-row-track");
  if (!track) return null;
  let node: HTMLElement | null = card;
  while (node && node.parentElement !== track) node = node.parentElement;
  return node;
}
/**
 * Opens the space the wide card needs by sliding the tiles it grows into.
 *
 * The card never covers a neighbour: the tiles on the side it grows toward step aside by
 * exactly the distance it reached, so the row stays a row and the hovered tile simply becomes
 * landscape. The card carries its own title, so the tile's caption folds away for the while.
 */
function arrangeRow(
  cell: HTMLElement | null,
  card: HTMLElement | null,
  delta: number,
  growsRight: boolean,
): void {
  restoreRow();
  if (!cell || !card || delta < 1) return;
  const track = cell.parentElement;
  if (!track) return;
  const base = cell.getBoundingClientRect();
  const shift = growsRight ? delta : -delta;
  for (const sibling of Array.from(track.children)) {
    if (!(sibling instanceof HTMLElement) || sibling === cell) continue;
    const rect = sibling.getBoundingClientRect();
    const ahead = growsRight ? rect.left >= base.left : rect.right <= base.right;
    if (!ahead) continue;
    tweakRow(sibling, { transform: `translate3d(${shift}px, 0, 0)` });
  }
  for (const child of Array.from(card.children)) {
    if (!(child instanceof HTMLElement)) continue;
    if (child.matches("[data-preview-anchor]") || child.querySelector("[data-preview-anchor]")) {
      continue;
    }
    tweakRow(child, { opacity: "0" });
  }
}

/**
 * Marks which edges of the synopsis still hide text, so a line cut at the bottom fades out
 * instead of stopping mid-air, and a line walked past the top edge fades the same way.
 *
 * Whether the text reaches either edge depends on the width the card was given and on how far the
 * reader has scrolled, so the marks are taken from the element's own geometry, not at render time.
 */
function markSynopsis(panel: HTMLElement): void {
  const synopsis = panel.querySelector<HTMLElement>(".midnight-preview-synopsis");
  if (!synopsis) return;
  const below = synopsis.scrollHeight - synopsis.clientHeight - synopsis.scrollTop;
  synopsis.dataset.midnightClipped = below > 1 ? "true" : "false";
  synopsis.dataset.midnightAbove = synopsis.scrollTop > 1 ? "true" : "false";
}

/** The writing, when there is more of it than the card shows. */
function scrollableSynopsis(panel: HTMLElement | null): HTMLElement | null {
  const synopsis = panel?.querySelector<HTMLElement>(".midnight-preview-synopsis");
  if (!synopsis) return null;
  return synopsis.scrollHeight > synopsis.clientHeight + 1 ? synopsis : null;
}

/**
 * Where a reading key lands in the synopsis: an arrow walks two lines, a page key the window
 * itself, and Home/End its two ends.
 */
function readTarget(synopsis: HTMLElement, key: string): number | null {
  const max = synopsis.scrollHeight - synopsis.clientHeight;
  const page = synopsis.clientHeight * 0.9;
  switch (key) {
    case "ArrowDown":
      return Math.min(max, synopsis.scrollTop + 44);
    case "ArrowUp":
      return Math.max(0, synopsis.scrollTop - 44);
    case "PageDown":
      return Math.min(max, synopsis.scrollTop + page);
    case "PageUp":
      return Math.max(0, synopsis.scrollTop - page);
    case "Home":
      return 0;
    case "End":
      return max;
    default:
      return null;
  }
}

function useFinePointer(): boolean {
  const [fine, setFine] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(hover: hover) and (pointer: fine)");
    const sync = () => setFine(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return fine;
}

export function MidnightHoverPreview() {
  const { settings } = useSettings();
  const viewState = useView();
  const searchOpen = useSearchOpen();
  const menu = useContextMenu();
  const t = useT();
  const finePointer = useFinePointer();
  const shape = usePreviewShape();
  // Harbor's dock magnification animates the same tiles the preview would move aside.
  const dockMagnify = settings.posterDockMagnification === true;

  const [session, setSession] = useState<Session | null>(null);
  const [art, setArt] = useState<PreviewArt | null>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const [shown, setShown] = useState(false);

  const sessionRef = useRef(0);
  const anchorRef = useRef<HTMLElement | null>(null);
  const pendingRef = useRef<HTMLElement | null>(null);
  // Card dismissed with Escape: it stays muted until the pointer leaves it, otherwise the
  // hover chain re-dispatches and the panel opens again immediately.
  const suppressedRef = useRef<HTMLElement | null>(null);
  const assemblyRef = useRef<PreviewAssembly | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  // The pointer rests on the frame: about to be read, so the arrows belong to the writing.
  const hoverRef = useRef(false);
  // The card whose writing was last reset to its top, so a new card never opens mid-sentence.
  const readAnchorRef = useRef<HTMLElement | null>(null);
  // The title the open frame belongs to. A tile can be mounted again under a motionless pointer,
  // and the fresh element is still the same card.
  const metaIdRef = useRef<string | null>(null);
  // Where the pointer last rested, so a delayed open can be checked against where it really is.
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  const dwellTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);
  const exitTimer = useRef<number | null>(null);

  const enabled =
    finePointer &&
    !settings.hoverPreviewEnabled &&
    viewState.player === null &&
    viewState.picker === null &&
    !viewState.chromeHidden &&
    !searchOpen &&
    menu.state === null;

  // Reading state. While the pointer rests on the frame and there is more writing than the frame
  // shows, the frame owns the keyboard: the board's arrows would otherwise pull focus out of the
  // text, onto the play button first and the chrome after that. The marker is the same "a layer
  // owns the input" signal the theme's own account menu carries, set on this frame and lifted the
  // moment the pointer leaves it.
  const syncReading = useCallback(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const reading = hoverRef.current && scrollableSynopsis(panel) !== null;
    panel.toggleAttribute("data-harbor-context-layer", reading);
  }, []);

  const clearTimers = useCallback(() => {
    if (dwellTimer.current !== null) {
      window.clearTimeout(dwellTimer.current);
      dwellTimer.current = null;
    }
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  const closeNow = useCallback(() => {
    clearTimers();
    hoverRef.current = false;
    // The frame leaves the reading state with the card, so it is back in the board's reach.
    panelRef.current?.removeAttribute("data-harbor-context-layer");
    // The row glides back over the same curve that opened it, so the tiles that made room for
    // the card return home while it settles out instead of snapping shut under it.
    releaseRow();
    sessionRef.current += 1;
    anchorRef.current = null;
    metaIdRef.current = null;
    pendingRef.current = null;
    assemblyRef.current?.cancel();
    assemblyRef.current = null;
    setShown(false);
    if (exitTimer.current !== null) window.clearTimeout(exitTimer.current);
    exitTimer.current = window.setTimeout(() => {
      exitTimer.current = null;
      setPlacement(null);
      setArt(null);
      setSession(null);
    }, EXIT_MS);
  }, [clearTimers]);

  /**
   * Whether the pointer really left the card.
   *
   * A `pointerout` is also dispatched when the tile under a motionless hand is replaced, or when a
   * neighbour slides across it, and it carries a null `relatedTarget` in that case - the same shape
   * a real exit takes. Answering the event itself therefore drops a frame the viewer is still
   * reading: on a dense grid the preview appears and fades straight away, and stays gone until the
   * hand moves again. The exit is decided against the hit test instead. The frame is held while the
   * pointer is on the frame, on the tile, or on another tile carrying the same title, which is what
   * a tile mounted again under the pointer hands back.
   */
  const pointerStillOnCard = useCallback((): boolean => {
    const at = pointerRef.current;
    const anchor = anchorRef.current;
    // Without a recorded position only the hover chain can answer - and the pointer can be resting
    // on the frame rather than on the tile it grew out of.
    if (!at) {
      if (anchor?.matches(":hover")) return true;
      return panelRef.current?.matches(":hover") ?? false;
    }
    const under = document.elementFromPoint(at.x, at.y);
    if (!under) return false;
    if (under.closest("[data-midnight-preview]")) return true;
    if (!anchor) return false;
    if (anchor === under || anchor.contains(under)) return true;
    const tile = under.closest<HTMLElement>("[data-preview-anchor]");
    if (!tile) return false;
    if (tile === anchor || anchor.contains(tile) || tile.contains(anchor)) return true;
    const id = metaIdRef.current;
    return id !== null && metaFromCard(tile)?.id === id;
  }, []);

  // The pointer-driven timers answer with this: a boundary event the hand did not cause must not
  // close a frame that is still under it.
  const closeIfPointerLeft = useCallback(() => {
    if (pointerStillOnCard()) return;
    closeNow();
  }, [closeNow, pointerStillOnCard]);

  const openFor = useCallback(
    (anchor: HTMLElement) => {
      if (anchorRef.current === anchor) return;
      const meta = metaFromCard(anchor);
      if (!meta) return;
      metaIdRef.current = meta.id;
      clearTimers();
      pendingRef.current = null;
      // A card that is still fading out is taken over by the new one instead of unmounting it.
      if (exitTimer.current !== null) {
        window.clearTimeout(exitTimer.current);
        exitTimer.current = null;
      }
      const id = sessionRef.current + 1;
      sessionRef.current = id;
      const assembly = assemblePreviewData(meta);
      assemblyRef.current = assembly;
      anchorRef.current = anchor;
      setArt(null);
      setPlacement(null);
      setShown(false);
      const card =
        anchor.closest<HTMLElement>("[data-media-card]") ??
        anchor.closest<HTMLElement>("button") ??
        anchor;
      setSession({
        anchor,
        card,
        cell: rowCellOf(card),
        data: assembly.data(),
        assembly,
      });
      assembly.onFinal(() => {
        if (sessionRef.current !== id) return;
        setSession((prev) => (prev ? { ...prev, data: assembly.data() } : prev));
      });
      assembly.markOpened((next) => {
        if (sessionRef.current === id) setArt(next);
      });
    },
    [clearTimers],
  );

  // Close when the surrounding gates close (playback, search, chrome hidden, view change).
  useEffect(() => {
    if (!enabled && anchorRef.current) closeNow();
  }, [enabled, closeNow]);

  useEffect(() => {
    if (!enabled) return;

    let lastScrollAt = 0;

    // Whether the pointer really rests on this tile. A held hover is answered against where the
    // pointer is now and not against where it was when the timer was armed: the row can keep
    // sliding while the timer counts down, and opening the tile that slid away would open the
    // preview over a card the pointer has already left. Without a recorded position the hover
    // chain is the only witness there is.
    const restsOn = (anchor: HTMLElement): boolean => {
      const at = pointerRef.current;
      if (!at) return anchor.matches(":hover");
      const el = document.elementFromPoint(at.x, at.y);
      return (el?.closest<HTMLElement>("[data-preview-anchor]") ?? null) === anchor;
    };

    /**
     * Opens the tile the pointer really rests on. A dwell that ends with the row having slid a
     * different tile under the pointer opens nothing: the preview belongs to the tile being read,
     * and the row moving on its own is a scroll, which closes previews rather than opening them.
     * The timer is dropped here first, so a dwell that ends without opening never leaves a
     * pending tile behind that would swallow the next hover.
     */
    const openRested = (anchor: HTMLElement): void => {
      dwellTimer.current = null;
      if (!restsOn(anchor)) {
        pendingRef.current = null;
        return;
      }
      openFor(anchor);
    };

    const onOver = (e: PointerEvent) => {
      if (e.pointerType === "touch" || e.buttons !== 0) return;
      const target = e.target as HTMLElement | null;
      const anchor = target?.closest<HTMLElement>("[data-preview-anchor]");
      if (!anchor) return;
      if (anchor === suppressedRef.current) return;
      if (anchor === anchorRef.current) {
        // Coming back onto the hovered card cancels a pending exit.
        if (closeTimer.current !== null) clearTimers();
        return;
      }
      // pointerover also fires when moving between the card's own children; only a new
      // card restarts the dwell timer.
      if (anchor === pendingRef.current && dwellTimer.current !== null) return;
      // Chrome re-dispatches pointerover after a scroll to repair the hover chain; opening a
      // panel there would pop cards open while the user is still scrolling. The card is held,
      // not dropped: a pointer that comes to rest on a tile the scroll carried under it gets no
      // second pointerover, so dropping this one would keep the preview away for good.
      const quiet = SCROLL_QUIET_MS - (performance.now() - lastScrollAt);
      if (quiet > 0) {
        clearTimers();
        pendingRef.current = anchor;
        dwellTimer.current = window.setTimeout(
          () => {
            openRested(anchor);
          },
          Math.round(quiet) + DWELL_MS,
        );
        return;
      }
      clearTimers();
      pendingRef.current = anchor;
      dwellTimer.current = window.setTimeout(() => openRested(anchor), DWELL_MS);
    };

    const onOut = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      const target = e.target as HTMLElement | null;
      const anchor = target?.closest<HTMLElement>("[data-preview-anchor]");
      if (!anchor) return;
      const to = e.relatedTarget as HTMLElement | null;
      if (to && (anchor.contains(to) || to.closest("[data-midnight-preview]"))) return;
      if (anchor === suppressedRef.current) suppressedRef.current = null;
      if (anchor === pendingRef.current && anchor !== anchorRef.current) {
        clearTimers();
        pendingRef.current = null;
        return;
      }
      if (anchor !== anchorRef.current) return;
      clearTimers();
      closeTimer.current = window.setTimeout(closeIfPointerLeft, CLOSE_MS);
    };

    const onFocusIn = (e: FocusEvent) => {
      const btn = (e.target as HTMLElement | null)?.closest?.("button");
      if (!btn || !btn.matches(":focus-visible")) return;
      const anchor = btn.querySelector<HTMLElement>("[data-preview-anchor]") ?? btn;
      openFor(anchor);
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && anchorRef.current) {
        suppressedRef.current = anchorRef.current;
        closeNow();
        return;
      }
      // Reading keys belong to the writing only while the pointer rests on the card; anywhere else
      // the arrows keep walking the board, which is what they are for.
      if (!hoverRef.current || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest?.("input, textarea, select, [contenteditable='true']")) return;
      const panel = panelRef.current;
      if (!panel) return;
      const synopsis = scrollableSynopsis(panel);
      if (!synopsis) return;
      const top = readTarget(synopsis, e.key);
      if (top === null) return;
      // The card is being read, so the board must not move with the key.
      e.preventDefault();
      e.stopPropagation();
      synopsis.scrollTo({
        top,
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      });
      markSynopsis(panel);
    };

    // Safety net: a missed pointerout (portals, relatedTarget quirks, layout shifts) must
    // still close the panel. Pointer movement off both the card and the panel counts as exit.
    // With nothing open it also repairs the other direction: a resting pointer that never got
    // its pointerover — a tile remounted by the row's lazy window, a hover chain rebuilt during
    // a scroll — arms the same dwell the over event would have armed.
    const onMove = (e: PointerEvent) => {
      pointerRef.current = { x: e.clientX, y: e.clientY };
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (!anchorRef.current) {
        if (e.pointerType === "touch" || e.buttons !== 0) return;
        const anchor = target.closest<HTMLElement>("[data-preview-anchor]");
        if (!anchor || anchor === suppressedRef.current) return;
        if (anchor === pendingRef.current && dwellTimer.current !== null) return;
        if (performance.now() - lastScrollAt < SCROLL_QUIET_MS) return;
        clearTimers();
        pendingRef.current = anchor;
        dwellTimer.current = window.setTimeout(() => openRested(anchor), DWELL_MS);
        return;
      }
      if (closeTimer.current !== null) return;
      if (target.closest("[data-midnight-preview]")) return;
      if (target.closest("[data-preview-anchor]") === anchorRef.current) return;
      // Landing on another card hands the preview over: the hover chain opens that one, so the
      // exit must be cancelled here or the two timers race and leave nothing open at all.
      if (target.closest("[data-preview-anchor]")) {
        if (closeTimer.current !== null) {
          window.clearTimeout(closeTimer.current);
          closeTimer.current = null;
        }
        return;
      }
      clearTimers();
      closeTimer.current = window.setTimeout(closeIfPointerLeft, CLOSE_MS);
    };

    const onClick = (e: MouseEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.("[data-midnight-preview]")) return;
      suppressedRef.current = null;
      if (anchorRef.current) closeNow();
    };

    const onScroll = (e: Event) => {
      // The writing walked down inside the card is not the board moving: this card stays.
      if ((e.target as HTMLElement | null)?.closest?.("[data-midnight-preview]")) return;
      lastScrollAt = performance.now();
      if (anchorRef.current) closeNow();
    };

    // A pointer that left the page rests nowhere; a timer that fires afterwards must not
    // answer with the place it left from. A leave that names where the pointer went is a move
    // inside the page - the frame taking the pointer from the tile is one - and the hand has not
    // gone anywhere, so the position stays.
    const onPointerLeave = (event: Event) => {
      const to = (event as PointerEvent).relatedTarget as Node | null;
      if (to) return;
      pointerRef.current = null;
    };

    document.addEventListener("pointerover", onOver, true);
    document.addEventListener("pointerleave", onPointerLeave, true);
    document.addEventListener("pointerout", onOut, true);
    document.addEventListener("pointermove", onMove, { capture: true, passive: true });
    document.addEventListener("focusin", onFocusIn);
    // Capture on window: other layers may swallow Escape during the bubble phase.
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("click", onClick, true);
    window.addEventListener("scroll", onScroll, { capture: true, passive: true });

    return () => {
      document.removeEventListener("pointerover", onOver, true);
      document.removeEventListener("pointerleave", onPointerLeave, true);
      document.removeEventListener("pointerout", onOut, true);
      document.removeEventListener("pointermove", onMove, true);
      document.removeEventListener("focusin", onFocusIn);
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("scroll", onScroll, true);
      clearTimers();
      if (exitTimer.current !== null) {
        window.clearTimeout(exitTimer.current);
        exitTimer.current = null;
      }
    };
  }, [enabled, openFor, closeNow, closeIfPointerLeft, clearTimers]);

  useLayoutEffect(() => {
    if (!session) return;
    const panel = panelRef.current;
    if (!panel) return;
    const body = panel.querySelector<HTMLElement>(".midnight-preview-body");

    // A new card starts at the top of its writing. The same card keeps the reader's place when only
    // its text lands later (the language answer arriving a beat after the frame opened).
    const synopsisEl = panel.querySelector<HTMLElement>(".midnight-preview-synopsis");
    if (synopsisEl && readAnchorRef.current !== session.anchor) {
      readAnchorRef.current = session.anchor;
      synopsisEl.scrollTop = 0;
    }

    const compute = () => {
      const rect = session.anchor.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return;
      const vw = window.innerWidth;

      if (shape === "card") {
        const next = placeCard(rect);
        panel.style.width = `${next.width}px`;
        panel.style.height = `${next.height}px`;
        setPlacement(next);
        // A magnifying dock owns the tiles' transforms; the preview leaves the row to it.
        if (dockMagnify) restoreRow();
        else arrangeRow(session.cell, session.card, next.delta, next.growsRight);
      } else if (shape === "front") {
        // Nothing in the row moves: the frame stands over the tile on its own.
        restoreRow();
        const next = placeFront(rect);
        panel.style.width = `${next.width}px`;
        panel.style.height = `${next.height}px`;
        setPlacement(next);
      } else {
        restoreRow();
        const centre = rect.left + rect.width / 2;
        const side = centre < vw * EDGE_BAND || centre > vw * (1 - EDGE_BAND);
        // One width for every placement. A narrower variant for cards near the edge squeezed
        // the details into a column barely wider than the pills and cut the synopsis short,
        // so the island no longer matched the one in the middle of the row.
        const width = Math.min(PANEL_W, vw - GUTTER * 2);
        const height = Math.round(width / PANEL_RATIO);
        panel.style.width = `${width}px`;
        panel.style.height = `${height}px`;
        setPlacement(placePanel(rect, width, height, side));
      }

      // The scrim is drawn to the writing rather than to a fraction of the frame: whatever the
      // artwork does behind it, the words stand on the same floor at every size and language.
      // The panel also reports which edge the writing sits on, so the floor can end there instead
      // of covering the side of the frame that carries the poster.
      // Layout boxes, never painted ones: the frame is still scaled while it opens, and a height
      // read through that transform would leave the floor a few pixels short for good.
      if (body) {
        const onLeft = body.offsetLeft + body.offsetWidth / 2 < panel.offsetWidth / 2;
        panel.style.setProperty("--midnight-veil-h", `${body.offsetHeight}px`);
        panel.style.setProperty("--midnight-veil-dir", onLeft ? "to right" : "to left");
      }
      markSynopsis(panel);
    };

    compute();
    const raf = requestAnimationFrame(() => setShown(true));
    const ro = new ResizeObserver(compute);
    ro.observe(panel);
    // The writing can change height on its own (a longer synopsis, a font that lands late) without
    // the frame changing size, and the scrim has to follow it.
    if (body) ro.observe(body);
    window.addEventListener("resize", compute);

    // A wheel over the card reads the writing instead of scrolling the board out from under it.
    // Over the text the browser already moves it and `overscroll-behavior: contain` keeps the page
    // out of it; anywhere else on the frame the delta is handed to the text here, so the card is
    // read from wherever the pointer happens to rest.
    const onWheel = (e: WheelEvent) => {
      const synopsis = scrollableSynopsis(panel);
      if (!synopsis || synopsis.contains(e.target as Node)) return;
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 20 : e.deltaMode === 2 ? synopsis.clientHeight : 1;
      synopsis.scrollTop += e.deltaY * unit;
      markSynopsis(panel);
    };
    // Both edges are re-marked as the text moves, so the fade always sits on the cut line.
    const onSynopsisScroll = () => markSynopsis(panel);
    panel.addEventListener("wheel", onWheel, { passive: false });
    synopsisEl?.addEventListener("scroll", onSynopsisScroll, { passive: true });

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      panel.removeEventListener("wheel", onWheel);
      synopsisEl?.removeEventListener("scroll", onSynopsisScroll);
      window.removeEventListener("resize", compute);
      restoreRow();
    };
  }, [session, shape, dockMagnify]);

  // The card speaks the language the details page speaks. A row arrives from a catalogue that
  // answers in the title's own language, so the writing is read again through TMDB. The hook runs
  // before the early return; it has to be called on every render, card or no card.
  const language = usePreviewLanguage(session?.data.meta ?? null);

  // The writing lands a beat after the frame (the language answer arriving), and the paragraph is
  // held at its line budget, so the fade would never be told about the text that arrived. It is
  // marked again with the text itself, ahead of the early return so the hook order holds.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (panel) markSynopsis(panel);
    // Whether there is anything to read decides whether the frame takes the keys at all.
    syncReading();
  }, [session, language.synopsis, syncReading]);

  if (!session || !enabled) return null;

  const { data } = session;
  const meta = data.meta;
  const name = language.name || meta.name;
  // Harbor primes art through a serial queue before publishing it; painting the backdrop
  // straight away (over the plate) shows the artwork at dwell speed instead of later.
  const fallbackSrc = meta.background
    ? rewriteTmdbRung(meta.background)
    : meta.poster
      ? rewriteTmdbRung(meta.poster)
      : null;
  const artSrc = art?.src ?? data.art.src ?? fallbackSrc;
  const hasResume = data.resume !== null;
  const chips = [
    data.year,
    // A duration and a season count leave the assembly in English; the pills carry catalogue
    // keys for both shapes, so they follow the interface language.
    data.length ? localizeFact(data.length, t) : null,
    data.genre ? t(data.genre) : null,
    data.rating ? `${data.rating.kind === "mal" ? "MAL" : "IMDb"} ${data.rating.value}` : null,
    data.contentRating,
  ].filter((value): value is string => !!value);

  const openCard = () => {
    const card = session.card;
    closeNow();
    card.click();
  };

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="false"
      aria-label={name}
      data-midnight-preview="true"
      data-midnight-preview-shape={shape}
      data-midnight-preview-art-side={placement?.artSide}
      // The front card is the wide card's look over the row; the shapes differ in where they
      // stand, not in how they are drawn.
      data-midnight-look={shape === "front" ? "card" : shape}
      data-open={shown ? "true" : "false"}
      className="midnight-preview"
      style={
        placement
          ? ({
              left: `${placement.left}px`,
              top: `${placement.top}px`,
              width: `${placement.width}px`,
              height: `${placement.height}px`,
              transformOrigin: placement.origin,
            } as React.CSSProperties)
          : { visibility: "hidden" }
      }
      onPointerEnter={() => {
        hoverRef.current = true;
        syncReading();
        clearTimers();
      }}
      onPointerLeave={() => {
        hoverRef.current = false;
        syncReading();
        clearTimers();
        closeTimer.current = window.setTimeout(closeIfPointerLeft, CLOSE_MS);
      }}
    >
      {/* The artwork is the card; the writing sits over it. */}
      <div className="midnight-preview-pane">
        <div data-midnight-preview-art="true" className="midnight-preview-art">
          <div aria-hidden="true" className="midnight-preview-plate" />
          {artSrc ? (
            <img
              src={artSrc}
              alt=""
              draggable={false}
              decoding="async"
              className="midnight-preview-img"
            />
          ) : null}
          <div aria-hidden="true" className="midnight-preview-veil" />
          {hasResume && data.resume?.fraction != null && (
            <div aria-hidden="true" className="midnight-preview-progress">
              <span style={{ width: `${Math.round(data.resume.fraction * 100)}%` }} />
            </div>
          )}
        </div>

        <div className="midnight-preview-body">
          <div className="midnight-preview-head">
            <h3 className="midnight-preview-title">{name}</h3>
            {data.chip && <span className="midnight-preview-chip">{t(data.chip)}</span>}
          </div>
          {chips.length > 0 && (
            <div className="midnight-preview-chips">
              {chips.map((chip) => (
                <span key={chip} className="midnight-preview-pill">
                  {/* A duration is digits plus a Latin word: loose inside an RTL line the digits
                      read as neutral and the word leads, so "123 min" painted as "min 123".
                      bdi lets each fact pick its own direction without turning the pill. */}
                  <bdi>{chip}</bdi>
                </span>
              ))}
            </div>
          )}
          {language.synopsis && <p className="midnight-preview-synopsis">{language.synopsis}</p>}
          <div className="midnight-preview-actions">
            <button type="button" className="midnight-preview-open" onClick={openCard}>
              {t("common.play")}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default MidnightHoverPreview;
