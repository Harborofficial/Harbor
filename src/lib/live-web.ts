import { enrichWithContent } from "./jina-search";
import { enrichWithKeenable } from "./keenable-search";
import type { Settings } from "./settings/types";

// Live web context for AI search, from the source picked under Settings > Live web.
export function liveWebContext(
  query: string,
  settings: Pick<Settings, "aiWebSource" | "jinaKey" | "keenableKey">,
) {
  return settings.aiWebSource === "keenable"
    ? enrichWithKeenable(query, settings.keenableKey)
    : enrichWithContent(query, settings.jinaKey);
}
