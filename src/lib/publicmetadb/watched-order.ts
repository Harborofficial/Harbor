import type { PmdbTarget } from "./types";

// Scope metadata stays with this snapshot and cannot leak into global history sets.
const absoluteOrderSnapshots = new WeakSet<Set<string>>();

export function scopePmdbWatchedOrder(
  keys: Set<string>,
  target: PmdbTarget,
  absoluteOrder: boolean,
): void {
  if (target.media_type === "tv" && target.tmdb_id != null && absoluteOrder)
    absoluteOrderSnapshots.add(keys);
}

export function pmdbUsesAbsoluteOrder(keys?: Set<string>): boolean {
  return keys != null && absoluteOrderSnapshots.has(keys);
}
