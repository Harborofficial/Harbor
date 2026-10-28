import { Check, Layers, Loader2, Sparkles } from "lucide-react";
import { useState } from "react";
import { socialPost } from "@/lib/social/client";
import { useT } from "@/lib/i18n";
import {
  AUTO_PROFILE_PALETTE,
  DEFAULT_CUSTOM_COLORS,
  PROFILE_PALETTES,
  PROFILE_PALETTE_ORDER,
  isHexColor,
  normalizeHexColor,
  parseProfileTheme,
  stripProfileTheme,
  themeCustomizationRecord,
  type CustomProfileColors,
  type ProfilePalette,
  type ProfilePaletteId,
  type ProfileTheme,
} from "@/lib/profile-theme";
import { CANVAS_DEFAULT } from "./customization/customization-types";
import type { ProfileSummary } from "./profile-types";

type Busy = "palette" | "glass" | "gradient" | null;

const CUSTOM_SLOTS: Array<{ key: keyof CustomProfileColors; label: string }> = [
  { key: "canvas", label: "Background" },
  { key: "surface", label: "Cards" },
  { key: "accent", label: "Accent" },
  { key: "ink", label: "Text" },
];

/** Anything beyond the theme marker means turning on customization would also publish it. */
function hasOtherCustomization(summary: ProfileSummary): boolean {
  return Boolean((summary.customHtml ?? "").trim() || stripProfileTheme(summary.customCss).trim());
}

function paletteFor(id: ProfilePaletteId): ProfilePalette | null {
  return id === "auto" || id === "custom" ? null : PROFILE_PALETTES[id];
}

type SwatchColors = { canvas: string; surface: string; accent: string };

function paletteSwatch(palette: ProfilePalette): SwatchColors {
  return {
    canvas: palette.tokens["--color-canvas"],
    surface: palette.tokens["--color-surface"],
    accent: palette.tokens["--color-accent"],
  };
}

function Swatch({ colors }: { colors?: SwatchColors | null }) {
  return (
    <span
      aria-hidden
      className="relative block h-10 w-14 shrink-0 overflow-hidden rounded-md ring-1 ring-edge-soft"
      style={{ background: colors?.canvas ?? "var(--color-canvas)" }}
    >
      <span
        className="absolute inset-x-1.5 bottom-1.5 h-4 rounded-sm"
        style={{ background: colors?.surface ?? "var(--color-surface)" }}
      />
      <span
        className="absolute end-1.5 top-1.5 h-2 w-2 rounded-full"
        style={{ background: colors?.accent ?? "var(--color-accent)" }}
      />
    </span>
  );
}

/** Starting point for the custom palette: whatever the owner is looking at right now. */
function seedColors(theme: ProfileTheme): CustomProfileColors {
  if (theme.palette === "custom" && theme.colors) return theme.colors;
  if (theme.savedCustomColors) return theme.savedCustomColors;
  if (theme.colors) return theme.colors;
  const palette = paletteFor(theme.palette);
  const pick = (token: string, fallback: string) => {
    const value = palette?.tokens[token] ?? "";
    return isHexColor(value) ? (normalizeHexColor(value) as string) : fallback;
  };
  return {
    canvas: pick("--color-canvas", DEFAULT_CUSTOM_COLORS.canvas),
    surface: pick("--color-surface", DEFAULT_CUSTOM_COLORS.surface),
    accent: pick("--color-accent", DEFAULT_CUSTOM_COLORS.accent),
    ink: pick("--color-ink", DEFAULT_CUSTOM_COLORS.ink),
  };
}

function CustomThemeEditor({
  colors,
  busy,
  onApply,
}: {
  colors: CustomProfileColors;
  busy: boolean;
  onApply: (colors: CustomProfileColors) => void;
}) {
  const t = useT();
  const [draft, setDraft] = useState<CustomProfileColors>(colors);
  const [error, setError] = useState<string | null>(null);
  const dirty = CUSTOM_SLOTS.some(({ key }) => draft[key] !== colors[key]);

  const set = (key: keyof CustomProfileColors, value: string) =>
    setDraft((cur) => ({ ...cur, [key]: value }));

  const apply = () => {
    const next = {} as CustomProfileColors;
    for (const { key, label } of CUSTOM_SLOTS) {
      const value = normalizeHexColor(draft[key]);
      if (!value)
        return setError(t("{label} needs a hex colour like #1a2b3c.", { label: t(label) }));
      next[key] = value;
    }
    setError(null);
    onApply(next);
  };

  const field =
    "w-[92px] rounded-md bg-canvas/70 px-2 py-1.5 text-[12px] uppercase tabular-nums text-ink outline-none ring-1 ring-edge-soft focus:ring-edge";

  return (
    <div className="mt-2 rounded-lg bg-canvas/40 p-3 ring-1 ring-edge-soft">
      <div className="grid gap-2 sm:grid-cols-2">
        {CUSTOM_SLOTS.map(({ key, label }) => (
          <label key={key} className="flex items-center gap-2">
            <span className="w-[74px] shrink-0 text-[12px] text-ink-muted">{t(label)}</span>
            <input
              type="color"
              aria-label={t(label)}
              value={isHexColor(draft[key]) ? draft[key] : colors[key]}
              onChange={(e) => set(key, e.target.value)}
              className="h-8 w-9 shrink-0 cursor-pointer rounded-md border-0 bg-transparent p-0"
            />
            <input
              value={draft[key]}
              maxLength={7}
              spellCheck={false}
              onChange={(e) => set(key, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") apply();
              }}
              className={field}
            />
          </label>
        ))}
      </div>

      <div className="mt-2.5 flex items-center justify-between gap-2">
        <span className="text-[11.5px] leading-relaxed text-ink-subtle">
          {t("Cards, accents and text are built from these four colours.")}
        </span>
        <button
          type="button"
          onClick={apply}
          disabled={!dirty || busy}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-accent px-3.5 text-[12px] font-semibold text-canvas transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {busy ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <Check size={12} strokeWidth={3} />
          )}
          {t("Apply colours")}
        </button>
      </div>
      {error && <p className="mt-1.5 text-[12px] text-danger">{error}</p>}
    </div>
  );
}

export function ProfileThemePicker({
  summary,
  onSaved,
}: {
  summary: ProfileSummary;
  onSaved: (next: ProfileSummary) => void;
}) {
  const t = useT();
  const [theme, setTheme] = useState<ProfileTheme>(() => parseProfileTheme(summary.customCss));
  const [busy, setBusy] = useState<Busy>(null);
  const [busyPalette, setBusyPalette] = useState<ProfilePaletteId | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The theme is published either way; this only describes the owner's own HTML and CSS,
  // which stay hidden until Custom Profile is switched on in Customize.
  const hiddenCustomization = !summary.customEnabled && hasOtherCustomization(summary);

  const apply = async (next: ProfileTheme, kind: Exclude<Busy, null>) => {
    if (busy) return;
    // Retain the last custom colors in component state as well as in the marker, so switching
    // away and back before unmounting works without requiring a reload.
    const retainedColors =
      next.palette === "custom"
        ? next.colors
        : (next.savedCustomColors ??
          (theme.palette === "custom" ? theme.colors : (theme.savedCustomColors ?? theme.colors)));
    const saved = retainedColors ? { ...next, savedCustomColors: retainedColors } : next;
    setBusy(kind);
    setBusyPalette(kind === "palette" ? next.palette : null);
    setError(null);
    try {
      // The customization endpoint replaces the fields it receives, so send the whole record
      // back with only the theme marker changed; otherwise saving a theme would wipe the rest.
      const updated = await socialPost<ProfileSummary>("/social/profile/customization", {
        ...themeCustomizationRecord(summary, saved, CANVAS_DEFAULT),
      });
      setTheme(saved);
      onSaved(updated);
    } catch (e) {
      setError((e as Error).message || t("Could not save your theme. Try again."));
    } finally {
      setBusy(null);
      setBusyPalette(null);
    }
  };

  const toggleClass = (on: boolean) =>
    `inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-medium transition-colors ring-1 ${
      on
        ? "bg-accent-soft text-accent ring-accent/40"
        : "text-ink-muted ring-edge-soft hover:bg-canvas/70"
    }`;

  const tileClass = (on: boolean) =>
    `flex min-h-[56px] items-center gap-2.5 rounded-lg p-2 text-start ring-1 transition-colors disabled:opacity-60 ${
      on ? "bg-canvas/80 ring-accent/50" : "ring-edge-soft hover:bg-canvas/60"
    }`;

  const tileBody = (id: ProfilePaletteId, name: string, blurb: string, swatch: SwatchColors) => (
    <>
      <Swatch colors={swatch} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1 text-[12.5px] font-medium text-ink">
          {t(name)}
          {busyPalette === id ? (
            <Loader2 size={12} className="animate-spin text-accent" />
          ) : (
            theme.palette === id && <Check size={12} strokeWidth={3} className="text-accent" />
          )}
        </span>
        <span className="mt-0.5 block truncate text-[11.5px] text-ink-subtle">{t(blurb)}</span>
      </span>
    </>
  );

  return (
    <div className="rounded-xl bg-elevated p-4 ring-1 ring-edge-soft">
      <div className="text-[13.5px] font-medium text-ink">{t("Profile theme")}</div>
      <div className="mt-0.5 text-[12.5px] leading-relaxed text-ink-subtle">
        {t("Colours visitors see on your profile. The rest of the app keeps their own theme.")}
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {PROFILE_PALETTE_ORDER.map((id) => {
          const palette = paletteFor(id);
          return (
            <button
              key={id}
              type="button"
              aria-pressed={theme.palette === id}
              disabled={!!busy}
              onClick={() => void apply({ ...theme, palette: id }, "palette")}
              className={tileClass(theme.palette === id)}
            >
              {tileBody(
                id,
                palette ? palette.name : AUTO_PROFILE_PALETTE.name,
                palette ? palette.blurb : AUTO_PROFILE_PALETTE.blurb,
                palette
                  ? paletteSwatch(palette)
                  : {
                      canvas: "var(--color-canvas)",
                      surface: "var(--color-surface)",
                      accent: "var(--color-accent)",
                    },
              )}
            </button>
          );
        })}

        <button
          type="button"
          aria-pressed={theme.palette === "custom"}
          disabled={!!busy}
          onClick={() => {
            const colors = seedColors(theme);
            void apply(
              { ...theme, palette: "custom", colors, savedCustomColors: colors },
              "palette",
            );
          }}
          className={tileClass(theme.palette === "custom")}
        >
          {tileBody("custom", "Custom", "Any colours you want, hex and all.", seedColors(theme))}
        </button>
      </div>

      {theme.palette === "custom" && (
        <CustomThemeEditor
          key={JSON.stringify(theme.colors)}
          colors={theme.colors ?? DEFAULT_CUSTOM_COLORS}
          busy={!!busy}
          onApply={(colors) =>
            void apply({ ...theme, colors, savedCustomColors: colors }, "palette")
          }
        />
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-pressed={theme.glass}
          disabled={!!busy}
          onClick={() => void apply({ ...theme, glass: !theme.glass }, "glass")}
          className={toggleClass(theme.glass)}
        >
          {busy === "glass" ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <Layers size={13} strokeWidth={2.2} />
          )}
          {t("Transparent cards")}
        </button>
        <button
          type="button"
          aria-pressed={theme.gradient}
          disabled={!!busy}
          onClick={() => void apply({ ...theme, gradient: !theme.gradient }, "gradient")}
          className={toggleClass(theme.gradient)}
        >
          {busy === "gradient" ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <Sparkles size={13} strokeWidth={2.2} />
          )}
          {t("Gradient wash")}
        </button>
      </div>

      {hiddenCustomization && (
        <p className="mt-3 text-[12px] leading-relaxed text-ink-subtle">
          {t(
            "Your theme is published to visitors either way. Your custom HTML and CSS stay hidden until Custom Profile is on in Customize.",
          )}
        </p>
      )}
      {error && <p className="mt-2 text-[12.5px] text-danger">{error}</p>}
    </div>
  );
}
