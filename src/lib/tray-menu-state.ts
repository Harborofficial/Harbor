import { DEFAULT_THEME, resolveTokens, type ThemeSettings } from "./theme";

export type TrayThemeEntry = { id: string; name: string };

export type TrayLabels = {
  show: string;
  theme: string;
  alwaysOnTop: string;
  pauseMinimized: string;
  pauseUnfocused: string;
  closeToTray: string;
  quit: string;
  error: string;
};

export type TrayDisplay = {
  themeId: string;
  themes: TrayThemeEntry[];
  tokens: Record<string, string>;
  labels: TrayLabels;
  direction: "ltr" | "rtl";
  colorScheme: "light" | "dark";
  menuWidth: number;
  themeWidth: number;
};

export const TRAY_MENU_FONT = "13px system-ui";

/** Row highlight color the tray menu owns; the theme's elevated tone is not reliably distinct. */
export const TRAY_HOVER_TOKEN = "--tray-row-hover";

/** Smallest surface-to-row contrast that still reads as a highlight. */
export const TRAY_HOVER_MIN_CONTRAST = 1.12;

export type TrayRgb = { r: number; g: number; b: number };

export const TRAY_TOKEN_KEYS = [
  "--color-canvas",
  "--color-surface",
  "--color-elevated",
  "--color-raised",
  "--color-ink",
  "--color-ink-muted",
  "--color-ink-subtle",
  "--color-edge",
  "--color-edge-soft",
  "--color-accent",
  "--color-accent-soft",
  "--color-danger",
] as const;

export function resolveTrayTokens(
  theme: ThemeSettings,
  computed: Partial<Record<string, string>>,
  supportsColor: (value: string) => boolean,
): Record<string, string> {
  const defaults = resolveTokens(DEFAULT_THEME);
  const active = resolveTokens(theme);
  const valid = (value: string | undefined): value is string =>
    !!value?.trim() &&
    !/^(?:inherit|initial|unset|revert(?:-layer)?|currentcolor)$/i.test(value.trim()) &&
    !/var\s*\(/i.test(value) &&
    supportsColor(value);
  return Object.fromEntries(
    TRAY_TOKEN_KEYS.map((key) => {
      const value = computed[key]?.trim();
      const fallback = active[key];
      return [key, valid(value) ? value : valid(fallback) ? fallback : defaults[key]];
    }),
  );
}

export function trayMenuWidths(
  labels: TrayLabels,
  themes: TrayThemeEntry[],
  measure: (text: string) => number,
): { menuWidth: number; themeWidth: number } {
  const widest = (values: string[]) =>
    values.reduce((width, text) => Math.max(width, measure(text)), 0);
  const commands = [
    labels.show,
    labels.theme,
    labels.alwaysOnTop,
    labels.pauseMinimized,
    labels.pauseUnfocused,
    labels.closeToTray,
    labels.quit,
  ];
  return {
    menuWidth: Math.min(420, Math.max(240, Math.ceil(widest(commands) + 76))),
    themeWidth: Math.min(
      360,
      Math.max(220, Math.ceil(widest(themes.map((theme) => theme.name)) + 64)),
    ),
  };
}

function channel(value: number): number {
  const scaled = value / 255;
  return scaled <= 0.04045 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(color: TrayRgb): number {
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
}

export function contrastRatio(a: TrayRgb, b: TrayRgb): number {
  const first = relativeLuminance(a);
  const second = relativeLuminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

function mix(from: TrayRgb, to: TrayRgb, amount: number): TrayRgb {
  const clamp = (value: number) => Math.max(0, Math.min(255, Math.round(value)));
  return {
    r: clamp(from.r + (to.r - from.r) * amount),
    g: clamp(from.g + (to.g - from.g) * amount),
    b: clamp(from.b + (to.b - from.b) * amount),
  };
}

function sameColor(a: TrayRgb, b: TrayRgb): boolean {
  return a.r === b.r && a.g === b.g && a.b === b.b;
}

/**
 * Picks the row highlight for the tray menu.
 *
 * The theme's elevated tone is not guaranteed to differ from the surface it
 * sits on, and several palettes use the same value for both, so a hover that
 * copies the theme reads as no hover at all. Prefer the theme's own tones and
 * only push further when neither separates enough from the surface.
 */
export function trayRowHoverColor(
  surface: TrayRgb,
  elevated: TrayRgb,
  raised: TrayRgb,
  minContrast: number = TRAY_HOVER_MIN_CONTRAST,
): TrayRgb {
  const candidates = [elevated, raised];
  for (const candidate of candidates) {
    if (contrastRatio(surface, candidate) >= minContrast) return candidate;
  }
  const best = candidates.reduce((a, b) =>
    contrastRatio(surface, b) > contrastRatio(surface, a) ? b : a,
  );
  // A candidate that matches the surface carries no direction, so pick one.
  const target = sameColor(best, surface)
    ? relativeLuminance(surface) < 0.5
      ? { r: 255, g: 255, b: 255 }
      : { r: 0, g: 0, b: 0 }
    : best;
  let low = 0;
  let high = 4;
  for (let step = 0; step < 24; step += 1) {
    const middle = (low + high) / 2;
    if (contrastRatio(surface, mix(surface, target, middle)) >= minContrast) high = middle;
    else low = middle;
  }
  return mix(surface, target, high);
}
