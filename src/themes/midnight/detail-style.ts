import { useEffect, useLayoutEffect, useState } from "react";

/**
 * How a title page is drawn.
 *
 * Harbour pins the writing of a title page to the bottom edge of a full-bleed backdrop and carries
 * all of its contrast on two scrims. The theme offers four ways to lift it, and the right to leave
 * the page exactly as Harbour drew it: `default` paints nothing at all, so a user who picks it gets
 * the stock page back, down to the episode list.
 *
 * The choice is kept locally and painted as one document attribute the stylesheet keys on - the
 * same reasoning as the hero's: Harbour's settings store lives outside this theme, and the theme
 * has to stay removable without a trace.
 */
export type MidnightDetailStyle = "default" | "glass" | "shelf" | "cinema" | "frame";

export const MIDNIGHT_DETAIL_STYLES: readonly MidnightDetailStyle[] = [
  "default",
  "glass",
  "shelf",
  "cinema",
  "frame",
];

/** A name for each choice, in the two languages the account menu already speaks. */
export const DETAIL_STYLE_NAME: Record<MidnightDetailStyle, { ar: string; en: string }> = {
  default: { ar: "افتراضي", en: "Default" },
  glass: { ar: "زجاجي", en: "Glass" },
  shelf: { ar: "رف", en: "Shelf" },
  cinema: { ar: "سينما", en: "Cinema" },
  frame: { ar: "إطار", en: "Frame" },
};

const STORAGE_KEY = "midnight.detail.style";
const DEFAULT_STYLE: MidnightDetailStyle = "glass";

const listeners = new Set<() => void>();

export function readDetailStyle(): MidnightDetailStyle {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value !== null && (MIDNIGHT_DETAIL_STYLES as readonly string[]).includes(value)
      ? (value as MidnightDetailStyle)
      : DEFAULT_STYLE;
  } catch {
    // Storage refused (private mode): the default still applies for this session.
    return DEFAULT_STYLE;
  }
}

export function writeDetailStyle(style: MidnightDetailStyle): void {
  try {
    localStorage.setItem(STORAGE_KEY, style);
  } catch {
    // Nothing to persist; the change still applies for this session.
  }
  for (const listener of listeners) listener();
}

/**
 * The attribute the stylesheet keys on. `default` removes it instead of naming a composition, so
 * every rule the theme wrote for the page is switched off by the same condition.
 */
function paint(style: MidnightDetailStyle): void {
  const root = document.documentElement;
  if (style === "default") delete root.dataset.midnightDetail;
  else root.dataset.midnightDetail = style;
}

function unpaint(): void {
  delete document.documentElement.dataset.midnightDetail;
}

/**
 * How many shells currently hold the attribute. Harbour can mount more than one on the way from one
 * view to the next, and each of them unpaints on unmount; clearing the document from the first one
 * to leave would strip the choice from the shell still on screen.
 */
let holders = 0;

export function useDetailStyle(): MidnightDetailStyle {
  const [style, setStyle] = useState<MidnightDetailStyle>(readDetailStyle);

  useEffect(() => {
    const sync = () => setStyle(readDetailStyle());
    listeners.add(sync);
    return () => {
      listeners.delete(sync);
    };
  }, []);

  // Layout time, not paint time: a remembered choice is in place before the first title page is
  // measured, instead of the stock page showing for a beat before it turns.
  useLayoutEffect(() => {
    paint(style);
  }, [style]);

  useLayoutEffect(() => {
    holders += 1;
    return () => {
      holders -= 1;
      if (holders === 0) unpaint();
    };
  }, []);

  return style;
}
