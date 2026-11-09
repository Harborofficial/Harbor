import type { Addon } from "./addons";
import type { Meta } from "./cinemeta";
import type { SearchResults } from "./search";
import { addonConfigurationKey } from "./addon-configuration-key";
import { metadataAddonKey, orderedMetadataAddons } from "./metadata-addons";
import { normalizeSearchQuery } from "./search-query";

export function addonsBeforeTmdb(addons: Addon[], chain: string[]): Addon[] {
  const tmdbAt = chain.indexOf("tmdb");
  if (tmdbAt <= 0) return [];
  const keys = new Set(
    chain
      .slice(0, tmdbAt)
      .filter((id) => id.startsWith("addon:"))
      .map((id) => id.slice("addon:".length)),
  );
  return addons.filter((addon) => keys.has(metadataAddonKey(addon)));
}

export function prioritizedTopMatch({
  chain,
  tmdbTop,
  addonTop,
  earlyAddonTop,
  tmdbEnabled,
}: {
  chain: string[];
  tmdbTop: SearchResults["topMatch"];
  addonTop: SearchResults["topMatch"];
  earlyAddonTop: SearchResults["topMatch"];
  tmdbEnabled: boolean;
}): SearchResults["topMatch"] {
  // The explicit TMDB toggle takes precedence over the metadata source order.
  if (tmdbEnabled && tmdbTop) return tmdbTop;
  if (chain.length === 0) return tmdbEnabled ? (tmdbTop ?? addonTop) : addonTop;
  const tmdbAt = chain.indexOf("tmdb");
  if (tmdbAt < 0) return addonTop;
  return earlyAddonTop ?? (tmdbEnabled ? tmdbTop : null) ?? addonTop;
}

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
