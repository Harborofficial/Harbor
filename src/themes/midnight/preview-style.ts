import { useEffect, useState } from "react";

/**
 * Shape the hover preview draws itself in.
 *
 * `card` is the poster widening into a landscape card inside its row: the row makes room, the
 * artwork keeps one side and the writing takes the other. `panel` is the floating wide island that
 * hangs below the row. `front` is the same split card, but laid over the tile it belongs to and
 * the tiles beside it instead of inside the row: it keeps the poster's own bottom edge, asks
 * nothing of the row, and so nothing in it can move under the hand.
 *
 * Harbor's settings store lives outside this theme, and the theme must stay removable without
 * a trace, so the choice is kept locally and offered from the theme's own account menu.
 */
export type MidnightPreviewShape = "card" | "panel" | "front";

const STORAGE_KEY = "midnight.previewShape";
const listeners = new Set<() => void>();

export function readPreviewShape(): MidnightPreviewShape {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === "panel" || stored === "front" ? stored : "card";
  } catch {
    // Storage refused (private mode): fall back to the default shape.
    return "card";
  }
}

export function writePreviewShape(shape: MidnightPreviewShape): void {
  try {
    localStorage.setItem(STORAGE_KEY, shape);
  } catch {
    // Nothing to persist; the change still applies for this session.
  }
  for (const listener of listeners) listener();
}

export function usePreviewShape(): MidnightPreviewShape {
  const [shape, setShape] = useState<MidnightPreviewShape>(readPreviewShape);

  useEffect(() => {
    const sync = () => setShape(readPreviewShape());
    listeners.add(sync);
    return () => {
      listeners.delete(sync);
    };
  }, []);

  return shape;
}
