// Rule: this module is data Harbour reads, plus the two things it cannot avoid. The player
// sheet: the shell stands down while the player is open, so a skin mounted with it would be
// missing the first time someone watches without visiting the board — it is small, gated behind
// `[data-theme-layout="midnight"]`, and paints nothing when the theme is off. The writing: the
// name and the blurb are answered at read time, because settings print both verbatim and look
// up no catalog of their own (see the getters below).
import "./styles/midnight-player.css";
import { getUiLanguage } from "@/lib/i18n";
import type { ThemePreset, ThemePresetId } from "@/lib/theme";

export const MIDNIGHT_PRESET: ThemePreset = {
  id: "midnight" as ThemePresetId,
  // Harbour prints `preset.name` verbatim in six places and resolves none of them, so the name
  // has to be right at read time: Arabic keeps the theme's own name, every other language the
  // English word. Nothing is translated in the catalogs, so no other string can pick it up.
  get name() {
    return getUiLanguage() === "ar" ? "دُجى" : "Midnight";
  },
  // Arabic is written, not carried over: the English sentence lists three qualities, and its
  // Arabic calque read like a machine had turned it over. This line keeps the same three things
  // — the glass, the motion, the light — but says them in Arabic order, with verbs. Every other
  // language keeps the English blurb, which is also the key the beta card looks up.
  get blurb() {
    return getUiLanguage() === "ar"
      ? "يلمع السوادُ زجاجًا، وتنساب الحركةُ على مهل، ولا يَثقل الضوءُ العين."
      : "Lightness, beauty, and graceful motion in deep dark glass.";
  },
  swatch: ["#000000", "#0d1117", "#8fb0cc"],
  tokens: {
    "--color-canvas": "#000000",
    "--color-surface": "#07090c",
    "--color-elevated": "#0d1117",
    "--color-raised": "#151b23",
    "--color-ink": "#eef2f6",
    "--color-ink-muted": "#8d99a8",
    "--color-ink-subtle": "#5f6b79",
    "--color-edge": "rgba(255, 255, 255, 0.09)",
    "--color-edge-soft": "rgba(255, 255, 255, 0.05)",
    "--color-accent": "#8fb0cc",
    "--color-accent-soft": "rgba(143, 176, 204, 0.14)",
    "--color-danger": "#ef5a6f",
  },
  background: {
    image:
      "radial-gradient(ellipse 680px 240px at 50% 0%, rgba(110, 150, 190, 0.14) 0%, transparent 70%), radial-gradient(ellipse 420px 480px at 0% 0%, rgba(110, 150, 190, 0.10) 0%, transparent 65%), radial-gradient(ellipse 420px 480px at 100% 0%, rgba(110, 150, 190, 0.10) 0%, transparent 65%), linear-gradient(180deg, #000000 0%, #000000 100%)",
    dim: 0,
  },
  layout: "midnight",
  cardStyle: "flat",
  buttonStyle: "flat",
  fontPair: "sentient-switzer",
};
