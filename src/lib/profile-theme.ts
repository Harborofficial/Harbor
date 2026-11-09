/**
 * Profile themes are colour-only skins for a profile page. The owner picks one and every
 * visitor sees it on that profile, while the rest of the app keeps the viewer's own theme.
 *
 * The choice travels inside the profile's custom CSS as a marker comment. That field is the
 * only publicly readable, owner-writable string the social API already round-trips, and we
 * cannot add a new profile column from the client.
 */

export type ProfilePaletteId =
  | "auto"
  | "custom"
  | "noir"
  | "midnight"
  | "ember"
  | "forest"
  | "ocean"
  | "violet"
  | "rose"
  | "paper";

export type CustomProfileColors = {
  canvas: string;
  surface: string;
  accent: string;
  ink: string;
};

export type ProfileTheme = {
  palette: ProfilePaletteId;
  /** Transparent, blurred cards. */
  glass: boolean;
  /** Accent-tinted background wash and accent-tinted card shadows. */
  gradient: boolean;
  /** Own colours when the palette is "custom". */
  colors?: CustomProfileColors;
  /** Last custom palette, retained while the active selection is a preset. */
  savedCustomColors?: CustomProfileColors;
};

export const DEFAULT_CUSTOM_COLORS: CustomProfileColors = {
  canvas: "#0b0b0f",
  surface: "#17171f",
  accent: "#f59e0b",
  ink: "#f6f6f8",
};

const HEX_RE = /^#[0-9a-f]{6}$/;

export function isHexColor(value: string): boolean {
  return HEX_RE.test(value.trim().toLowerCase());
}

/** Lower-cased #rrggbb, expanding #rgb; null when the value is not a hex colour. */
export function normalizeHexColor(value: string): string | null {
  const v = value.trim().toLowerCase();
  if (HEX_RE.test(v)) return v;
  const short = /^#([0-9a-f]{3})$/.exec(v);
  if (!short) return null;
  return `#${short[1].replace(/./g, (c) => c + c)}`;
}

type PaletteColors = {
  canvas: string;
  surface: string;
  elevated: string;
  raised: string;
  ink: string;
  muted: string;
  subtle: string;
  edge: string;
  edgeSoft: string;
  accent: string;
  accentSoft: string;
  danger: string;
  success: string;
};

export type ProfilePalette = {
  id: Exclude<ProfilePaletteId, "auto" | "custom">;
  name: string;
  blurb: string;
  light?: boolean;
  tokens: Record<string, string>;
};

export const DEFAULT_PROFILE_THEME: ProfileTheme = {
  palette: "auto",
  glass: false,
  gradient: false,
};

function tokens(c: PaletteColors): Record<string, string> {
  return {
    "--color-canvas": c.canvas,
    "--color-surface": c.surface,
    "--color-elevated": c.elevated,
    "--color-raised": c.raised,
    "--color-ink": c.ink,
    "--color-ink-muted": c.muted,
    "--color-ink-subtle": c.subtle,
    "--color-edge": c.edge,
    "--color-edge-soft": c.edgeSoft,
    "--color-accent": c.accent,
    "--color-accent-soft": c.accentSoft,
    "--color-danger": c.danger,
    "--color-success": c.success,
  };
}

function palette(
  id: ProfilePalette["id"],
  name: string,
  blurb: string,
  colors: PaletteColors,
  light = false,
): ProfilePalette {
  return { id, name, blurb, light, tokens: tokens(colors) };
}

export const PROFILE_PALETTES: Record<
  Exclude<ProfilePaletteId, "auto" | "custom">,
  ProfilePalette
> = {
  noir: palette("noir", "Noir", "Pure black, white light.", {
    canvas: "#000000",
    surface: "#060606",
    elevated: "#0c0c0c",
    raised: "#171717",
    ink: "#f5f5f5",
    muted: "#a3a3a3",
    subtle: "#6b6b6b",
    edge: "rgba(255, 255, 255, 0.10)",
    edgeSoft: "rgba(255, 255, 255, 0.05)",
    accent: "#ffffff",
    accentSoft: "rgba(255, 255, 255, 0.14)",
    danger: "#e25454",
    success: "#5fd38a",
  }),
  midnight: palette("midnight", "Midnight", "Deep navy, azure accent.", {
    canvas: "#070b14",
    surface: "#0c1220",
    elevated: "#121a2b",
    raised: "#1b2537",
    ink: "#eaf0fb",
    muted: "#a4b0c4",
    subtle: "#6c7a90",
    edge: "rgba(148, 163, 184, 0.22)",
    edgeSoft: "rgba(148, 163, 184, 0.10)",
    accent: "#4f8ef7",
    accentSoft: "rgba(79, 142, 247, 0.18)",
    danger: "#ef5f6b",
    success: "#48c78e",
  }),
  ember: palette("ember", "Ember", "Warm charcoal, amber glow.", {
    canvas: "#0d0907",
    surface: "#150f0b",
    elevated: "#1e1610",
    raised: "#2a1e15",
    ink: "#f7ece3",
    muted: "#c2a995",
    subtle: "#8b7461",
    edge: "rgba(214, 168, 120, 0.20)",
    edgeSoft: "rgba(214, 168, 120, 0.09)",
    accent: "#f28c3a",
    accentSoft: "rgba(242, 140, 58, 0.18)",
    danger: "#e2594f",
    success: "#5fbf82",
  }),
  forest: palette("forest", "Forest", "Deep green, mint accent.", {
    canvas: "#06100c",
    surface: "#0a1712",
    elevated: "#0f1f18",
    raised: "#16291f",
    ink: "#e6f4ec",
    muted: "#a3b9ad",
    subtle: "#6d8579",
    edge: "rgba(110, 231, 183, 0.18)",
    edgeSoft: "rgba(110, 231, 183, 0.08)",
    accent: "#3ddc97",
    accentSoft: "rgba(61, 220, 151, 0.16)",
    danger: "#e2685f",
    success: "#4fcf8a",
  }),
  ocean: palette("ocean", "Ocean", "Deep teal, aqua accent.", {
    canvas: "#04100f",
    surface: "#071a19",
    elevated: "#0b2321",
    raised: "#10302d",
    ink: "#e2f5f3",
    muted: "#9dbfbb",
    subtle: "#6a8e8a",
    edge: "rgba(94, 234, 212, 0.18)",
    edgeSoft: "rgba(94, 234, 212, 0.08)",
    accent: "#2fd4c4",
    accentSoft: "rgba(47, 212, 196, 0.16)",
    danger: "#e4685f",
    success: "#43cfa1",
  }),
  violet: palette("violet", "Violet", "Dark plum, lilac accent.", {
    canvas: "#0b0714",
    surface: "#110c1e",
    elevated: "#171128",
    raised: "#211834",
    ink: "#f0e9ff",
    muted: "#b6a8d4",
    subtle: "#7f7099",
    edge: "rgba(167, 139, 250, 0.20)",
    edgeSoft: "rgba(167, 139, 250, 0.09)",
    accent: "#a78bfa",
    accentSoft: "rgba(167, 139, 250, 0.18)",
    danger: "#ef5f7a",
    success: "#5fd3a4",
  }),
  rose: palette("rose", "Rose", "Dark plum, pink light.", {
    canvas: "#12070c",
    surface: "#1a0a12",
    elevated: "#230e18",
    raised: "#2f1420",
    ink: "#fbeaf1",
    muted: "#c9a3b3",
    subtle: "#91707e",
    edge: "rgba(244, 114, 182, 0.18)",
    edgeSoft: "rgba(244, 114, 182, 0.08)",
    accent: "#f472b6",
    accentSoft: "rgba(244, 114, 182, 0.16)",
    danger: "#ef5f6b",
    success: "#5fd3a4",
  }),
  paper: palette(
    "paper",
    "Paper",
    "Warm off-white, ink and terracotta.",
    {
      canvas: "#f5f2ec",
      surface: "#ffffff",
      elevated: "#faf7f2",
      raised: "#efeae1",
      ink: "#1b1917",
      muted: "#57514a",
      subtle: "#8a837a",
      edge: "rgba(27, 25, 23, 0.14)",
      edgeSoft: "rgba(27, 25, 23, 0.07)",
      accent: "#b4552d",
      accentSoft: "rgba(180, 85, 45, 0.14)",
      danger: "#b3261e",
      success: "#1f7a44",
    },
    true,
  ),
};

export const PROFILE_PALETTE_ORDER: ProfilePaletteId[] = [
  "auto",
  "noir",
  "midnight",
  "ember",
  "forest",
  "ocean",
  "violet",
  "rose",
  "paper",
];

export const AUTO_PROFILE_PALETTE = {
  name: "Automatic",
  blurb: "Follows each visitor's own theme.",
};

const MARKER_NAME = "harbor-profile-theme";
const MARKER_RE = /\/\*\s*harbor-profile-theme:([^*]*)\*\//g;

const PALETTE_IDS = new Set<string>([...Object.keys(PROFILE_PALETTES), "custom"]);

function normalizeColors(value: unknown): CustomProfileColors {
  const raw = (value ?? {}) as Record<string, unknown>;
  const pick = (key: keyof CustomProfileColors) => {
    const v = typeof raw[key] === "string" ? normalizeHexColor(raw[key] as string) : null;
    return v ?? DEFAULT_CUSTOM_COLORS[key];
  };
  return {
    canvas: pick("canvas"),
    surface: pick("surface"),
    accent: pick("accent"),
    ink: pick("ink"),
  };
}

function normalizeTheme(value: unknown): ProfileTheme {
  if (!value || typeof value !== "object") return DEFAULT_PROFILE_THEME;
  const raw = value as Record<string, unknown>;
  const palette =
    typeof raw.palette === "string" && PALETTE_IDS.has(raw.palette)
      ? (raw.palette as ProfilePaletteId)
      : "auto";
  const theme: ProfileTheme = {
    palette,
    glass: raw.glass === true,
    gradient: raw.gradient === true,
  };
  if (palette === "custom") {
    theme.colors = normalizeColors(raw.colors);
    // Older custom markers only stored `colors`; migrate that to the retained palette so
    // the first switch to a preset doesn't lose it.
    theme.savedCustomColors = normalizeColors(raw.savedCustomColors ?? raw.colors);
  } else if (raw.savedCustomColors && typeof raw.savedCustomColors === "object") {
    theme.savedCustomColors = normalizeColors(raw.savedCustomColors);
  }
  return theme;
}

export function isDefaultProfileTheme(theme: ProfileTheme): boolean {
  return theme.palette === "auto" && !theme.glass && !theme.gradient && !theme.savedCustomColors;
}

/** The theme stored in a profile's custom CSS, or the default when absent or unreadable. */
export function parseProfileTheme(css?: string | null): ProfileTheme {
  if (!css) return DEFAULT_PROFILE_THEME;
  MARKER_RE.lastIndex = 0;
  const match = MARKER_RE.exec(css);
  MARKER_RE.lastIndex = 0;
  if (!match) return DEFAULT_PROFILE_THEME;
  try {
    return normalizeTheme(JSON.parse(match[1]));
  } catch {
    return DEFAULT_PROFILE_THEME;
  }
}

/** The owner's own CSS with every theme marker removed. */
export function stripProfileTheme(css?: string | null): string {
  if (!css) return "";
  return css.replace(MARKER_RE, "").trimStart();
}

/**
 * Store a theme in the custom CSS without disturbing the owner's rules. The default theme
 * leaves no marker behind, so a profile without a theme carries no trace of this feature.
 */
export function withProfileTheme(css: string | null | undefined, theme: ProfileTheme): string {
  const body = stripProfileTheme(css);
  if (isDefaultProfileTheme(theme)) return body;
  const payload: Record<string, unknown> = {
    palette: theme.palette,
    glass: theme.glass,
    gradient: theme.gradient,
  };
  // Only own colours need shipping; every preset is rebuilt from its id.
  const savedCustomColors =
    theme.palette === "custom"
      ? normalizeColors(theme.colors)
      : theme.savedCustomColors
        ? normalizeColors(theme.savedCustomColors)
        : theme.colors
          ? normalizeColors(theme.colors)
          : undefined;
  if (savedCustomColors) {
    // Persist the draft alongside a preset so returning to Custom restores the last colours.
    payload.savedCustomColors = savedCustomColors;
    if (theme.palette === "custom") payload.colors = savedCustomColors;
  }
  const marker = `/*${MARKER_NAME}:${JSON.stringify(payload)}*/`;
  return body ? `${marker}\n${body}` : marker;
}

/** The customization fields a theme save has to send back untouched. */
export type CustomizationSource = {
  profileFont?: string;
  profileFavicon?: string;
  pageBgColor?: string;
  pageBgImage?: string;
  customHtml?: string;
  customCss?: string;
  canvasHeight?: number;
  customEnabled?: boolean;
  hideTopBanner?: boolean;
  hideCardTitles?: boolean;
};

/**
 * The record the customization endpoint expects when only the theme changed: every field is
 * echoed as it stands and only the custom CSS gains the marker, so saving a theme cannot wipe
 * the owner's other customization. Custom Profile is copied, never toggled - a theme is
 * published whether that switch is on or off, so saving one must not turn it on (or off).
 */
export function themeCustomizationRecord(
  summary: CustomizationSource,
  theme: ProfileTheme,
  canvasDefault: number,
): Required<CustomizationSource> {
  return {
    profileFont: summary.profileFont ?? "",
    profileFavicon: summary.profileFavicon ?? "",
    pageBgColor: summary.pageBgColor ?? "",
    pageBgImage: summary.pageBgImage ?? "",
    customHtml: summary.customHtml ?? "",
    customCss: withProfileTheme(summary.customCss, theme),
    canvasHeight: summary.canvasHeight ?? canvasDefault,
    customEnabled: summary.customEnabled ?? false,
    hideTopBanner: summary.hideTopBanner ?? false,
    hideCardTitles: summary.hideCardTitles ?? false,
  };
}

export type ProfileThemeScope = {
  /** CSS custom properties for the profile root; children inherit them. */
  vars: Record<string, string>;
  backgroundColor: string;
  backgroundImage: string;
  colorScheme?: "light" | "dark";
  /** Space-separated flags rendered as `data-profile-ui` for the stylesheet hooks. */
  ui: string;
};

const GRADIENT_WASH =
  "radial-gradient(130% 100% at 15% 0%, color-mix(in oklab, var(--color-accent) 26%, transparent) 0%, transparent 58%), " +
  "radial-gradient(90% 70% at 90% 8%, color-mix(in oklab, var(--color-accent) 14%, transparent) 0%, transparent 62%)";

/** Background declarations for a themed root; an explicit owner background always wins. */
export function profileThemeBackground(
  scope: ProfileThemeScope,
  customBackground?: string | null,
): Record<string, string> {
  if (customBackground) return { background: customBackground };
  const out: Record<string, string> = {};
  if (scope.backgroundColor) out.backgroundColor = scope.backgroundColor;
  if (scope.backgroundImage) out.backgroundImage = scope.backgroundImage;
  return out;
}

/** Tokens built from the owner's own colours; the extra shades are mixed from them. */
export function customProfileTokens(colors: CustomProfileColors): Record<string, string> {
  const { canvas, surface, accent, ink } = colors;
  const mix = (a: string, aPct: number, b: string, bPct: number) =>
    `color-mix(in oklab, ${a} ${aPct}%, ${b} ${bPct}%)`;
  return {
    "--color-canvas": canvas,
    "--color-surface": surface,
    "--color-elevated": mix(surface, 86, ink, 14),
    "--color-raised": mix(surface, 74, ink, 26),
    "--color-ink": ink,
    "--color-ink-muted": mix(ink, 70, canvas, 30),
    "--color-ink-subtle": mix(ink, 52, canvas, 48),
    "--color-edge": `color-mix(in oklab, ${ink} 22%, transparent)`,
    "--color-edge-soft": `color-mix(in oklab, ${ink} 10%, transparent)`,
    "--color-accent": accent,
    "--color-accent-soft": `color-mix(in oklab, ${accent} 20%, transparent)`,
  };
}

function isLightHex(hex: string): boolean {
  const v = normalizeHexColor(hex) ?? "#000000";
  const r = parseInt(v.slice(1, 3), 16);
  const g = parseInt(v.slice(3, 5), 16);
  const b = parseInt(v.slice(5, 7), 16);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.55;
}

/** How much of each surface colour survives when the transparent look is on. */
const GLASS_ALPHA: Record<string, number> = {
  "--color-surface": 62,
  "--color-elevated": 55,
  "--color-raised": 48,
};

export function profileThemeScope(theme: ProfileTheme): ProfileThemeScope {
  const palette = theme.palette;
  const source: Record<string, string> | null =
    palette === "custom"
      ? customProfileTokens(theme.colors ?? DEFAULT_CUSTOM_COLORS)
      : palette === "auto"
        ? null
        : { ...PROFILE_PALETTES[palette].tokens };
  const vars: Record<string, string> = {};
  if (source) {
    for (const [key, value] of Object.entries(source)) {
      // Translucent surfaces let the owner's background (or gradient) show through the cards.
      const alpha = theme.glass ? GLASS_ALPHA[key] : undefined;
      vars[key] = alpha ? `color-mix(in oklab, ${value} ${alpha}%, transparent)` : value;
    }
    // Surfaces that must stay readable (quoted reviews, dialogs) use the opaque values.
    vars["--profile-surface-solid"] = source["--color-surface"];
    vars["--profile-elevated-solid"] = source["--color-elevated"];
  }
  const light =
    palette === "custom"
      ? isLightHex((theme.colors ?? DEFAULT_CUSTOM_COLORS).canvas)
      : palette === "auto"
        ? null
        : PROFILE_PALETTES[palette].light === true;
  const ui = [
    theme.glass ? "glass" : "",
    theme.glass && !source ? "glass-auto" : "",
    theme.gradient ? "gradient" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return {
    vars,
    // An own palette paints the page itself; the theme's own colours stay opaque so the
    // viewer's app theme never bleeds into someone else's profile.
    backgroundColor: source?.["--color-canvas"] ?? (theme.gradient ? "var(--color-canvas)" : ""),
    backgroundImage: theme.gradient ? GRADIENT_WASH : "",
    colorScheme: light === null ? undefined : light ? "light" : "dark",
    ui,
  };
}
