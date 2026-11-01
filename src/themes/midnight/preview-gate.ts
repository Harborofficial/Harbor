import { hoverPeekOwner, type HoverPeekClaim } from "@/lib/hover-preview/ownership";

export type MidnightPreviewGate = HoverPeekClaim & {
  finePointer: boolean;
  playing: boolean;
  pickerOpen: boolean;
  chromeHidden: boolean;
  searchOpen: boolean;
  menuOpen: boolean;
};

/**
 * Whether Midnight draws its own hover preview right now.
 *
 * Whether the peek belongs to the theme at all is the shared claim in
 * src/lib/hover-preview/ownership.ts: the user's "Peek at a title on hover" owns the feature and is
 * off by default, so the theme never treats an unchecked setting as a request for its card, and it
 * stands down from the hover styles the host renders per card. What is left here is the theme's own
 * sense of when a card would be in the way: while something is playing, while a picker, the search
 * board or a context menu holds the screen, or when the pointer is not a pointer.
 */
export function midnightPreviewEnabled(gate: MidnightPreviewGate): boolean {
  return (
    gate.finePointer &&
    hoverPeekOwner(gate) === "theme" &&
    !gate.playing &&
    !gate.pickerOpen &&
    !gate.chromeHidden &&
    !gate.searchOpen &&
    !gate.menuOpen
  );
}
