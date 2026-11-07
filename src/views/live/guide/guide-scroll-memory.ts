import { PX_PER_MS, WINDOW_PX } from "./guide-utils";

export type GuideScrollSnapshot = {
  /** Time at the left edge of the visible timeline. */
  atMs: number;
  top: number;
};

const MAX_SOURCES = 16;
const memory = new Map<string, GuideScrollSnapshot>();

export function rememberGuideScroll(key: string, snapshot: GuideScrollSnapshot): void {
  memory.delete(key);
  memory.set(key, snapshot);
  while (memory.size > MAX_SOURCES) {
    const oldest = memory.keys().next().value;
    if (oldest === undefined) break;
    memory.delete(oldest);
  }
}

export function recallGuideScroll(key: string): GuideScrollSnapshot | null {
  return memory.get(key) ?? null;
}

export function guideScrollTime(windowStart: number, scrollLeft: number): number {
  return windowStart + scrollLeft / PX_PER_MS;
}

export function guideScrollLeftFor(
  snapshot: GuideScrollSnapshot,
  windowStart: number,
  viewport: number,
): number | null {
  const left = (snapshot.atMs - windowStart) * PX_PER_MS;
  const max = Math.max(0, WINDOW_PX - Math.max(0, viewport));
  if (!Number.isFinite(left) || left < 0 || left > max) return null;
  return left;
}
