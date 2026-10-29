import { invoke } from "@tauri-apps/api/core";
import type { Settings } from "@/lib/settings";
import { mpvExtraOptionKeys } from "./mpv-tuning";

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

function mpvColor(hex: string, opacity: number): string {
  const rgb = hex.startsWith("#") && hex.length === 7 ? hex.slice(1).toUpperCase() : "FFFFFF";
  const a = Math.round(clamp(opacity, 0, 1) * 255)
    .toString(16)
    .padStart(2, "0")
    .toUpperCase();
  return `#${a}${rgb}`;
}

function mpvFontFor(id: string, customName?: string): string {
  if (id.startsWith("custom:")) return customName || "Inter";
  switch (id) {
    case "arabic":
      return "Vazirmatn";
    case "system":
      return "Segoe UI";
    case "serif":
      return "Times New Roman";
    case "rounded":
      return "Fredoka";
    default:
      return "Inter";
  }
}

function customFontName(s: Settings): string | undefined {
  if (!s.subFontFamily?.startsWith("custom:")) return undefined;
  const id = s.subFontFamily.slice("custom:".length);
  const f = (s.customFonts ?? []).find((x) => x.id === id);
  return f?.family || f?.name;
}

const POS_GLIDE_MS = 260;
const POS_STEP_MS = 16;

function reducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Writes one mpv position property, skipping stale values and gliding between targets. */
function positionWriter(name: string) {
  let shown: number | null = null;
  let pending: number | null = null;
  let drain: Promise<void> | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let finish: (() => void) | null = null;

  const write = (value: number): Promise<void> => {
    shown = value;
    pending = value;
    drain ??= (async () => {
      while (pending != null) {
        const next = pending;
        pending = null;
        await invoke("mpv_set_property", { name, value: next }).catch(() => {});
      }
      drain = null;
    })();
    return drain;
  };
  const stop = () => {
    clearTimeout(timer);
    timer = undefined;
    finish?.();
    finish = null;
  };

  return {
    set(value: number): Promise<void> {
      stop();
      return write(value);
    },
    glide(target: number): Promise<void> {
      stop();
      const from = shown;
      if (from == null || from === target || reducedMotion()) return write(target);
      const start = Date.now();
      return new Promise((resolve) => {
        finish = resolve;
        const tick = () => {
          const t = Math.min(1, (Date.now() - start) / POS_GLIDE_MS);
          const eased = 1 - (1 - t) ** 3;
          const done = write(Math.round((from + (target - from) * eased) * 100) / 100);
          if (t < 1) {
            timer = setTimeout(tick, POS_STEP_MS);
            return;
          }
          timer = undefined;
          finish = null;
          void done.then(resolve);
        };
        tick();
      });
    },
  };
}

const subPos = positionWriter("sub-pos");
const secondaryPos = positionWriter("secondary-sub-pos");

/**
 * The sub-pos that keeps a subtitle's lower edge `clearPct` percent up the subtitle area.
 * mpv also leaves sub-margin-y (in 720-line scaled pixels) below that line, so the lift
 * only has to cover what the margin doesn't.
 */
function liftedSubPos(clearPct: number, marginY: number): number {
  if (!(clearPct > 0)) return 100;
  const margin = clamp((Number(marginY) || 0) / 720, 0, 0.9);
  const raise = (clearPct / 100 - margin) / (1 - margin);
  return clamp(100 - raise * 100, 0, 100);
}

let secondaryStyleRevision = 0;
let secondaryStyleQueue: Promise<void> = Promise.resolve();

function secondarySubPos(
  placement: Settings["subSecondaryPlacement"],
  marginY: number,
  liftPct: number,
): number {
  if (placement === "top") return 0;
  const base = 100 - (Number(marginY) || 0);
  return clamp((liftPct > 0 ? Math.min(base, liftedSubPos(liftPct, marginY)) : base) - 8, 0, 100);
}

/** HDR surfaces need mpv to draw the second subtitle instead of the HTML overlay. */
export function applySecondarySubNative(
  on: boolean,
  placement: Settings["subSecondaryPlacement"],
  marginY: number,
  liftPct = 0,
): Promise<void> {
  const revision = ++secondaryStyleRevision;
  // Serialize native writes so a delayed enable cannot overtake a later disable.
  secondaryStyleQueue = secondaryStyleQueue.then(async () => {
    if (revision !== secondaryStyleRevision) return;
    if (on) {
      await secondaryPos.set(secondarySubPos(placement, marginY, liftPct));
      if (revision !== secondaryStyleRevision) return;
    }
    await invoke("mpv_set_property", {
      name: "secondary-sub-visibility",
      value: on,
    }).catch(() => {});
  });
  return secondaryStyleQueue;
}

/** Glides a natively drawn second subtitle to its place without toggling its visibility. */
export function applySecondarySubPos(
  placement: Settings["subSecondaryPlacement"],
  marginY: number,
  liftPct: number,
): Promise<void> {
  return secondaryPos.glide(secondarySubPos(placement, marginY, liftPct));
}

export type SubRenderContext = {
  assNativeActive: boolean;
  imageNativeActive: boolean;
  assScale?: number;
  sdhFilterAllowed?: boolean;
  /** Percent of the subtitle area, from the bottom, a subtitle's lower edge must stay above. */
  liftPct?: number;
};

export type OsdBox = { h: number; mt: number; mb: number };

const LIFT_GAP_PCT = 1;

/**
 * Converts the share of the window the controls cover into the subtitle area a subtitle
 * must clear. Without sub-use-margins mpv places subtitles inside the video, so letterbox
 * bars already under the controls need no lift.
 */
export function subPosLiftPercent(
  coverShare: number,
  osd: OsdBox | null,
  useMargins: boolean,
): number {
  if (!(coverShare > 0)) return 0;
  if (!osd || !(osd.h > 0)) return clamp(coverShare * 100 + LIFT_GAP_PCT, 0, 100);
  const mt = useMargins ? 0 : Math.max(0, osd.mt);
  const mb = useMargins ? 0 : Math.max(0, osd.mb);
  const area = osd.h - mt - mb;
  if (area <= 0) return 0;
  const clear = coverShare * osd.h - mb;
  if (clear <= 0) return 0;
  return clamp((clear / area) * 100 + LIFT_GAP_PCT, 0, 100);
}

export async function readOsdBox(): Promise<OsdBox | null> {
  const [h, mt, mb] = await Promise.all(
    ["h", "mt", "mb"].map((key) =>
      invoke<unknown>("mpv_get_property", { name: `osd-dimensions/${key}` }).catch(() => null),
    ),
  );
  if (typeof h !== "number") return null;
  return { h, mt: Number(mt) || 0, mb: Number(mb) || 0 };
}

/** ASS modes that keep each styled subtitle's own look, so the player's override switch is off. */
export type AssLookMode = "no" | "scale" | "font";

export function isAssLookMode(mode: Settings["subAssOverride"]): mode is AssLookMode {
  return mode === "no" || mode === "scale" || mode === "font";
}

/**
 * Flips the player's "Override embedded styles" switch. Switching it off goes back to the mode
 * the user had before, so "Change font only" or the size option isn't lost on the way.
 */
export function flipAssOverride(
  mode: Settings["subAssOverride"],
  before: AssLookMode,
): { mode: Settings["subAssOverride"]; before: AssLookMode } {
  return isAssLookMode(mode) ? { mode: "force", before: mode } : { mode: before, before };
}

const STYLE_OVERRIDES = "sub-ass-style-overrides";

/** mpv reads a list option as comma-separated items, where "\," is a comma inside an item. */
function mpvListText(items: string[]): string {
  return items.map((item) => item.replace(/,/g, "\\,")).join(",");
}

function sameItems(a: string[] | null, b: string[]): boolean {
  return a != null && a.length === b.length && a.every((item, i) => item === b[i]);
}

// Harbor only touches mpv's style overrides while "Change font only" is on. It reads the list mpv
// has, adds the font to it, and puts that exact list back when the mode is left.
let ownStyleOverrides: string[] | null = null;
let harborStyleOverrides: string[] | null = null;
let styleOverridesQueue: Promise<void> = Promise.resolve();

function setStyleOverrides(items: string[]): Promise<boolean> {
  return invoke("mpv_set_property", { name: STYLE_OVERRIDES, value: mpvListText(items) }).then(
    () => true,
    () => false,
  );
}

function applyFontOnlyOverrides(fontOnly: boolean, font: string): Promise<void> {
  // Each change reads mpv's list first, so the steps must not overlap.
  styleOverridesQueue = styleOverridesQueue
    .then(async () => {
      if (!fontOnly && !harborStyleOverrides) return;
      const current = await invoke<string[]>("mpv_get_property_list", {
        name: STYLE_OVERRIDES,
      }).catch(() => null);
      if (!current) return;
      // Any other list means a new mpv started from the user's own options, so there is nothing
      // of Harbor's to undo and the new list is the one to keep.
      const harborsList = sameItems(harborStyleOverrides, current);
      if (!fontOnly) {
        if (harborsList && ownStyleOverrides) await setStyleOverrides(ownStyleOverrides);
        ownStyleOverrides = null;
        harborStyleOverrides = null;
        return;
      }
      if (!harborsList) ownStyleOverrides = current;
      const next = [...(ownStyleOverrides ?? []).filter(Boolean), `FontName=${font}`];
      harborStyleOverrides = (await setStyleOverrides(next)) ? next : null;
    })
    .catch(() => {});
  return styleOverridesQueue;
}

const DEFAULT_CONTEXT: SubRenderContext = {
  assNativeActive: false,
  imageNativeActive: false,
};

/** mpv exposes some subtitle properties under legacy alias names. Pinning any
 * alias must stop Harbor writing the rest, or the alias write overwrites it. */
const SUB_PROPERTY_ALIASES: Record<string, string> = {
  "sub-outline-color": "sub-border-color",
  "sub-outline-size": "sub-border-size",
  "sub-shadow-color": "sub-back-color",
};

function canonicalSubProperty(name: string): string {
  return SUB_PROPERTY_ALIASES[name] ?? name;
}

/**
 * The subtitle properties Harbor owns. Keys set explicitly in Advanced
 * (mpv.conf) are left out so they keep the value mpv_start applied.
 */
export function subStyleProperties(
  s: Settings,
  context: SubRenderContext = DEFAULT_CONTEXT,
): Array<[string, unknown]> {
  const override = s.subAssOverride;
  // "Change font only" keeps the ASS look like "no". mpv's "yes" then lets the style override
  // below swap in the user's font.
  const fontOnly = override === "font";
  const keepAssLook = override === "no" || fontOnly;
  const normScale =
    typeof context.assScale === "number" && Number.isFinite(context.assScale)
      ? context.assScale
      : null;
  const effOverride = fontOnly ? "yes" : normScale != null ? "scale" : override;
  const assMargins = subUsesMargins(s, context) ? "yes" : "no";
  const marginY = clamp(Number(s.subMarginY) || 0, 0, 100);
  const liftPct = clamp(Number(context.liftPct) || 0, 0, 100);
  const opacity = clamp(Number(s.subOpacity ?? 1), 0.1, 1);
  const boxOpacity = clamp(Number(s.subBoxOpacity ?? 0.6), 0, 1);
  const isBox = s.subStyle === "box";
  const isShadow = s.subStyle === "shadow";
  const reposition = !context.assNativeActive || !keepAssLook;
  const hideSdh = s.subHideSdh === true && context.sdhFilterAllowed !== false;
  const font = mpvFontFor(s.subFontFamily, customFontName(s));
  const props: Array<[string, unknown]> = [
    ["sub-filter-sdh", hideSdh],
    ["sub-filter-sdh-harder", false],
    ["sub-font-size", 32],
    ["sub-font", font],
    [
      "sub-scale",
      normScale != null
        ? clamp(normScale, 0.2, 6)
        : Math.min(4, Math.max(0.4, (Number(s.subFontSize) || 32) / 32)),
    ],
    ["sub-color", mpvColor(s.subFontColor, opacity)],
    ["sub-border-color", mpvColor(s.subBorderColor, opacity)],
    ["sub-border-size", s.subBorderSize],
    ["sub-back-color", isBox ? mpvColor(s.subBoxColor, boxOpacity * opacity) : "#00000000"],
    ["sub-shadow-color", mpvColor("#000000", opacity)],
    ["sub-shadow-offset", isShadow ? 1.4 : 0],
    ["sub-margin-y", marginY],
    ["sub-align-x", s.subAlignX],
    ["sub-ass-override", effOverride],
    ["sub-ass-force-margins", assMargins],
    ["sub-use-margins", assMargins],
    ["sub-spacing", s.subLineSpacing],
    ["sub-bold", s.subBold ? "yes" : "no"],
    [
      "sub-pos",
      Math.min(reposition ? clamp(100 - marginY, 0, 100) : 100, liftedSubPos(liftPct, marginY)),
    ],
  ];
  const overridden = new Set([...mpvExtraOptionKeys(s.mpvExtraOptions)].map(canonicalSubProperty));
  return props.filter(([name]) => !overridden.has(canonicalSubProperty(name)));
}

/** With margins on, mpv may place subtitles in the letterbox bars instead of inside the video. */
export function subUsesMargins(s: Settings, context: SubRenderContext): boolean {
  const keepAssLook = s.subAssOverride === "no" || s.subAssOverride === "font";
  return context.assNativeActive && !keepAssLook;
}

/** Glides only sub-pos, so showing or hiding the controls doesn't resend every style. */
export function applySubPos(s: Settings, context: SubRenderContext): Promise<void> {
  const entry = subStyleProperties(s, context).find(([name]) => name === "sub-pos");
  if (!entry) return Promise.resolve();
  return subPos.glide(Number(entry[1]));
}

export async function applySubStyle(
  s: Settings,
  context: SubRenderContext = DEFAULT_CONTEXT,
): Promise<void> {
  await Promise.all([
    ...subStyleProperties(s, context).map(([name, value]) =>
      name === "sub-pos"
        ? subPos.set(Number(value))
        : invoke("mpv_set_property", { name, value }).catch(() => {}),
    ),
    applyFontOnlyOverrides(s.subAssOverride === "font", mpvFontFor(s.subFontFamily, customFontName(s))),
  ]);
}
