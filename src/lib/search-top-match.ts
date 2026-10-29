import type { Addon } from "./addons";
import type { Meta } from "./cinemeta";
import type { SearchResults } from "./search";
import { addonConfigurationKey } from "./addon-configuration-key";
import { metadataAddonKey, orderedMetadataAddons } from "./metadata-addons";
import { normalizeSearchQuery } from "./search-query";

export function addonTopMatch(
  addons: Addon[],
  metas: Meta[],
  query: string,
  order?: string[],
): SearchResults["topMatch"] {
  const wanted = normalizeSearchQuery(query);
  for (const addon of orderedMetadataAddons(addons, order)) {
    const key = metadataAddonKey(addon);
    const matches = metas.filter((meta) => {
      if (
        !meta.id ||
        !meta.name ||
        meta.isCollection ||
        !["movie", "series", "anime"].includes(meta.type)
      )
        return false;
      const origin = meta.addonOrigin;
      if (!origin) return false;
      const originKey =
        origin.configurationKey ?? (origin.base ? addonConfigurationKey(origin.base) : undefined);
      return originKey ? originKey === key : origin.id === addon.manifest.id;
    });
    const score = (meta: Meta) => {
      const name = normalizeSearchQuery(meta.name);
      return name === wanted ? 2 : name.startsWith(wanted) ? 1 : 0;
    };
    matches.sort((a, b) => score(b) - score(a));
    const meta = matches[0];
    if (meta)
      return {
        kind: meta.type === "movie" ? "movie" : "series",
        meta,
        popularity: 0,
        backdrop: meta.background,
        overview: meta.description,
      };
  }
  return null;
}
