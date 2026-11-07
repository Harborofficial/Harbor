import type { Meta } from "@/lib/cinemeta";
import { isTitleWatched, type WatchedLookup } from "@/lib/watched-title";

/** Same watched-title matching as the featured hero and catalog rows. */
export function filterUnwatchedRecommendations(
  items: Meta[],
  hideWatched: boolean,
  lookup: WatchedLookup,
): Meta[] {
  if (!hideWatched) return items;
  return items.filter((item) => !isTitleWatched(item, lookup));
}
