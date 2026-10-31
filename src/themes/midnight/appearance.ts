import { useLayoutEffect, useState } from "react";

/**
 * Appearance the theme paints itself in, beyond the shape of the hover preview.
 *
 * `oled` lifts every surface Harbour sets to true black. `palette` moves the accent the theme
 * tints its glass with: the nav indicator, the preview's plate, the streaming rail. Neither
 * touches the ink tokens, so words stay exactly as legible as they were before the change.
 *
 * Harbour's settings store lives outside this theme, and the theme must stay removable without
 * a trace, so the choice is kept locally and offered from the theme's own account menu. The
 * attributes that carry it are written by the shell and removed again when it unmounts.
 */
export type MidnightPalette = "frost" | "amber" | "mint" | "lilac" | "rose";

export type MidnightAppearance = {
  oled: boolean;
  palette: MidnightPalette;
};

const OLED_KEY = "midnight.oled";
const PALETTE_KEY = "midnight.palette";

export const MIDNIGHT_PALETTES: readonly MidnightPalette[] = [
  "frost",
  "amber",
  "mint",
  "lilac",
  "rose",
];

/** The colour each palette paints. The stylesheet carries the same five under the same names. */
export const PALETTE_ACCENT: Record<MidnightPalette, string> = {
  frost: "#8fb0cc",
  amber: "#e2b779",
  mint: "#7fd6bd",
  lilac: "#b4a6e8",
  rose: "#e6a2b0",
};

/** A palette's own name, in the two languages the account menu already speaks. */
export const PALETTE_NAME: Record<MidnightPalette, { ar: string; en: string }> = {
  frost: { ar: "صقيع", en: "Frost" },
  amber: { ar: "عنبر", en: "Amber" },
  mint: { ar: "نعناع", en: "Mint" },
  lilac: { ar: "ليلَك", en: "Lilac" },
  rose: { ar: "ورد", en: "Rose" },
};

const listeners = new Set<() => void>();

function isPalette(value: string | null): value is MidnightPalette {
  return value != null && (MIDNIGHT_PALETTES as readonly string[]).includes(value);
}

export function readAppearance(): MidnightAppearance {
  try {
    const palette = localStorage.getItem(PALETTE_KEY);
    return {
      oled: localStorage.getItem(OLED_KEY) === "on",
      palette: isPalette(palette) ? palette : "frost",
    };
  } catch {
    // Storage refused (private mode): the default appearance still applies for this session.
    return { oled: false, palette: "frost" };
  }
}

function announce(): void {
  for (const listener of listeners) listener();
}

export function writeOled(oled: boolean): void {
  try {
    localStorage.setItem(OLED_KEY, oled ? "on" : "off");
  } catch {
    // Nothing to persist; the change still applies for this session.
  }
  announce();
}

export function writePalette(palette: MidnightPalette): void {
  try {
    localStorage.setItem(PALETTE_KEY, palette);
  } catch {
    // Nothing to persist; the change still applies for this session.
  }
  announce();
}

/**
 * The two attributes the stylesheet keys on. Both sit on the document so portalled layers - the
 * hover preview, menus, dialogs - read the same values as the board behind them.
 */
function paint(appearance: MidnightAppearance): void {
  const root = document.documentElement;
  root.dataset.midnightOled = appearance.oled ? "on" : "off";
  root.dataset.midnightPalette = appearance.palette;
}

function unpaint(): void {
  const root = document.documentElement;
  delete root.dataset.midnightOled;
  delete root.dataset.midnightPalette;
}

/**
 * How many shells currently hold the attributes. Harbour can mount more than one on the way from
 * one view to the next, and each of them unpaints on unmount; clearing the document from the
 * first one to leave would strip the palette from the shell still on screen.
 */
let holders = 0;

export function useAppearance(): MidnightAppearance {
  const [appearance, setAppearance] = useState(readAppearance);

  useLayoutEffect(() => {
    const sync = () => setAppearance(readAppearance());
    listeners.add(sync);
    return () => {
      listeners.delete(sync);
    };
  }, []);

  // Layout time, not paint time: a remembered OLED setting is in place for the shell's first
  // frame instead of arriving as one grey flash behind the board.
  useLayoutEffect(() => {
    paint(appearance);
  }, [appearance]);

  useLayoutEffect(() => {
    holders += 1;
    return () => {
      holders -= 1;
      if (holders === 0) unpaint();
    };
  }, []);

  return appearance;
}
