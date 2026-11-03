import type { CardHoverStyle } from "@/components/pick-card/card-hover";
import type { ThemeLayout } from "@/lib/theme";

/**
 * Who draws the hover peek card, decided in one place so the built-in panel and a theme's own card
 * can never both claim it - or both stand down while the user asked for one.
 *
 * The setting is the user's request and it is off by default, so off means no card at all. The style
 * then says which card: the gallery's built-in entries are drawn by the panel, and every other entry
 * is drawn per card by pick-card, where no panel is involved.
 */

/** The hover styles the built-in panel implements. */
const BUILT_IN_PEEK_STYLES: ReadonlySet<CardHoverStyle> = new Set<CardHoverStyle>([
  "default",
  "marquee",
]);

/** Layouts that replace the built-in panel with a card of their own. */
const THEME_PEEK_LAYOUTS: ReadonlySet<ThemeLayout> = new Set<ThemeLayout>(["midnight"]);

export type HoverPeekOwner = "none" | "harbor" | "theme";

export type HoverPeekClaim = {
  hoverPreviewEnabled: boolean;
  cardHoverStyle: CardHoverStyle;
  layout: ThemeLayout;
};

export function hoverPeekOwner(claim: HoverPeekClaim): HoverPeekOwner {
  if (!claim.hoverPreviewEnabled) return "none";
  if (!BUILT_IN_PEEK_STYLES.has(claim.cardHoverStyle)) return "none";
  return THEME_PEEK_LAYOUTS.has(claim.layout) ? "theme" : "harbor";
}
