import { useEffect, useLayoutEffect, useState } from "react";

/**
 * How the home hero is drawn.
 *
 * `style` picks the composition itself: the stock card, the theme's own hairline polish, the
 * artwork split off from the writing, a centred cinema frame, a floating island, or a full-bleed
 * billboard. The four knobs tune the result on top of it: height, where the writing sits, how dark
 * the artwork is held, and how round the frame is.
 *
 * Every knob's first value means "as Harbour draws it", so a card that was never touched keeps the
 * stock geometry and the theme adds nothing. The same reasoning as the preview's shape: Harbour's
 * settings store lives outside this theme, and the theme must stay removable without a trace, so
 * the choices are kept locally and painted as document attributes the stylesheet keys on.
 */
export type MidnightHeroStyle =
  | "classic"
  | "refined"
  | "split"
  | "cinema"
  | "island"
  | "billboard";
export type MidnightHeroHeight = "auto" | "short" | "tall";
export type MidnightHeroText = "start" | "center" | "end";
export type MidnightHeroScrim = "auto" | "soft" | "deep";
export type MidnightHeroRadius = "auto" | "sharp" | "round";

export type MidnightHero = {
  style: MidnightHeroStyle;
  height: MidnightHeroHeight;
  text: MidnightHeroText;
  scrim: MidnightHeroScrim;
  radius: MidnightHeroRadius;
};

export const MIDNIGHT_HERO_STYLES: readonly MidnightHeroStyle[] = [
  "classic",
  "refined",
  "split",
  "cinema",
  "island",
  "billboard",
];
export const MIDNIGHT_HERO_HEIGHTS: readonly MidnightHeroHeight[] = ["auto", "short", "tall"];
export const MIDNIGHT_HERO_TEXTS: readonly MidnightHeroText[] = ["start", "center", "end"];
export const MIDNIGHT_HERO_SCRIMS: readonly MidnightHeroScrim[] = ["auto", "soft", "deep"];
export const MIDNIGHT_HERO_RADII: readonly MidnightHeroRadius[] = ["auto", "sharp", "round"];

/** A name for each choice, in the two languages the account menu already speaks. */
export const HERO_STYLE_NAME: Record<MidnightHeroStyle, { ar: string; en: string }> = {
  classic: { ar: "الحالي", en: "Classic" },
  refined: { ar: "لمسات", en: "Refined" },
  split: { ar: "مقسوم", en: "Split" },
  cinema: { ar: "سينما", en: "Cinema" },
  island: { ar: "عائمة", en: "Island" },
  billboard: { ar: "بانر", en: "Billboard" },
};

export const HERO_HEIGHT_NAME: Record<MidnightHeroHeight, { ar: string; en: string }> = {
  auto: { ar: "افتراضي", en: "Default" },
  short: { ar: "قصير", en: "Short" },
  tall: { ar: "مرتفع", en: "Tall" },
};

export const HERO_TEXT_NAME: Record<MidnightHeroText, { ar: string; en: string }> = {
  start: { ar: "بداية", en: "Start" },
  center: { ar: "وسط", en: "Center" },
  end: { ar: "النهاية", en: "End" },
};

export const HERO_SCRIM_NAME: Record<MidnightHeroScrim, { ar: string; en: string }> = {
  auto: { ar: "افتراضي", en: "Default" },
  soft: { ar: "خفيف", en: "Soft" },
  deep: { ar: "عميق", en: "Deep" },
};

export const HERO_RADIUS_NAME: Record<MidnightHeroRadius, { ar: string; en: string }> = {
  auto: { ar: "افتراضي", en: "Default" },
  sharp: { ar: "حاد", en: "Sharp" },
  round: { ar: "دائري", en: "Round" },
};

const STYLE_KEY = "midnight.hero.style";
const HEIGHT_KEY = "midnight.hero.height";
const TEXT_KEY = "midnight.hero.text";
const SCRIM_KEY = "midnight.hero.scrim";
const RADIUS_KEY = "midnight.hero.radius";

const DEFAULTS: MidnightHero = {
  style: "classic",
  height: "auto",
  text: "start",
  scrim: "auto",
  radius: "auto",
};

const listeners = new Set<() => void>();

function pick<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value !== null && (allowed as readonly string[]).includes(value)
      ? (value as T)
      : fallback;
  } catch {
    // Storage refused (private mode): the default still applies for this session.
    return fallback;
  }
}

export function readHero(): MidnightHero {
  return {
    style: pick(STYLE_KEY, MIDNIGHT_HERO_STYLES, DEFAULTS.style),
    height: pick(HEIGHT_KEY, MIDNIGHT_HERO_HEIGHTS, DEFAULTS.height),
    text: pick(TEXT_KEY, MIDNIGHT_HERO_TEXTS, DEFAULTS.text),
    scrim: pick(SCRIM_KEY, MIDNIGHT_HERO_SCRIMS, DEFAULTS.scrim),
    radius: pick(RADIUS_KEY, MIDNIGHT_HERO_RADII, DEFAULTS.radius),
  };
}

function persist(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Nothing to persist; the change still applies for this session.
  }
}

export function writeHero(patch: Partial<MidnightHero>): void {
  if (patch.style !== undefined) persist(STYLE_KEY, patch.style);
  if (patch.height !== undefined) persist(HEIGHT_KEY, patch.height);
  if (patch.text !== undefined) persist(TEXT_KEY, patch.text);
  if (patch.scrim !== undefined) persist(SCRIM_KEY, patch.scrim);
  if (patch.radius !== undefined) persist(RADIUS_KEY, patch.radius);
  for (const listener of listeners) listener();
}

/**
 * The five attributes the stylesheet keys on. They sit on the document so the hero reads the same
 * values whether it was drawn by the shell that is mounted now or the one that replaced it.
 */
function paint(hero: MidnightHero): void {
  const root = document.documentElement;
  root.dataset.midnightHero = hero.style;
  root.dataset.midnightHeroHeight = hero.height;
  root.dataset.midnightHeroText = hero.text;
  root.dataset.midnightHeroScrim = hero.scrim;
  root.dataset.midnightHeroRadius = hero.radius;
}

function unpaint(): void {
  const root = document.documentElement;
  delete root.dataset.midnightHero;
  delete root.dataset.midnightHeroHeight;
  delete root.dataset.midnightHeroText;
  delete root.dataset.midnightHeroScrim;
  delete root.dataset.midnightHeroRadius;
}

/**
 * How many shells currently hold the attributes. Harbour can mount more than one on the way from
 * one view to the next, and each of them unpaints on unmount; clearing the document from the
 * first one to leave would strip the choice from the shell still on screen.
 */
let holders = 0;

export function useHero(): MidnightHero {
  const [hero, setHero] = useState(readHero);

  useEffect(() => {
    const sync = () => setHero(readHero());
    listeners.add(sync);
    return () => {
      listeners.delete(sync);
    };
  }, []);

  // Layout time, not paint time: a remembered choice is in place for the shell's first frame
  // instead of the stock card showing for a beat before it turns.
  useLayoutEffect(() => {
    paint(hero);
  }, [hero]);

  useLayoutEffect(() => {
    holders += 1;
    return () => {
      holders -= 1;
      if (holders === 0) unpaint();
    };
  }, []);

  return hero;
}
