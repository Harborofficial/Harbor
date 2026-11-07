import { useEffect, useState, useSyncExternalStore, type RefObject } from "react";

const insets = new Map<symbol, number>();
const listeners = new Set<() => void>();
let current = 0;

function publish(): void {
  let next = 0;
  for (const value of insets.values()) next = Math.max(next, value);
  if (next === current) return;
  current = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Share of the window height, from the bottom, covered by the visible player controls. */
export function usePlayerControlsInset(): number {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => 0,
  );
}

/**
 * The controls cover subtitles should rise above. Moving the subtitles while the controls
 * are showing pauses the lift until the controls hide, so the new position is visible.
 */
export function useSubtitleLiftCover(enabled: boolean, marginY: number): number {
  const inset = usePlayerControlsInset();
  const [seenMargin, setSeenMargin] = useState(marginY);
  const [paused, setPaused] = useState(false);
  if (seenMargin !== marginY) {
    setSeenMargin(marginY);
    setPaused(inset > 0);
  } else if (paused && inset <= 0) {
    setPaused(false);
  }
  return enabled && !paused && seenMargin === marginY ? inset : 0;
}

/**
 * Publishes how much of the window a bottom control bar covers while it is visible. The bar's
 * top padding only carries its fade gradient, so it does not count as covered.
 */
export function useReportPlayerControlsInset(
  ref: RefObject<HTMLElement | null>,
  visible: boolean,
): void {
  useEffect(() => {
    const el = ref.current;
    if (!visible || !el) return;
    const key = Symbol("player-controls");
    const measure = () => {
      const height = window.innerHeight;
      if (height <= 0) return;
      const padTop = parseFloat(getComputedStyle(el).paddingTop) || 0;
      const top = el.getBoundingClientRect().top + padTop;
      const share = Math.min(0.6, Math.max(0, (height - top) / height));
      insets.set(key, Math.round(share * 1000) / 1000);
      publish();
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
      insets.delete(key);
      publish();
    };
  }, [ref, visible]);
}
