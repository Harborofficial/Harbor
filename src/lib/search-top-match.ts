import type { Addon } from "./addons";
import type { Meta } from "./cinemeta";
import type { AnimeHit, SearchResults } from "./search";
import { addonConfigurationKey } from "./addon-configuration-key";
import { metadataAddonKey, orderedMetadataAddons } from "./metadata-addons";
import { normalizeSearchQuery } from "./search-query";

// Compare titles without punctuation: "Bleach: Thousand-Year Blood War" and
// "Bleach Thousand Year Blood War" are the same result.
function titleKey(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function sameSearchTitle(name: string | null | undefined, query: string): boolean {
  if (!name) return false;
  return titleKey(name) === titleKey(query);
}

function animeYear(hit: AnimeHit): number {
  const year = Number(hit.year);
  return Number.isFinite(year) && year > 0 ? year : Number.POSITIVE_INFINITY;
}

export function animeTopMatch(anime: AnimeHit[], query: string): SearchResults["topMatch"] {
  const wanted = titleKey(query);
  if (!wanted) return null;
  const exact = anime.find((a) => titleKey(a.name) === wanted);
  const prefix = anime.filter((a) => wanted.length >= 4 && titleKey(a.name).startsWith(wanted));
  // A franchise prefix like "rascal does not dream of" matches several entries;
  // use the oldest, which is the franchise's base series, not the newest cour.
  const earliest = prefix.sort((a, b) => animeYear(a) - animeYear(b))[0];
  const contains =
    wanted.split(" ").length >= 2 ? anime.filter((a) => titleKey(a.name).includes(wanted)) : [];
  const hit = exact ?? earliest ?? (contains.length === 1 ? contains[0] : undefined);
  if (!hit) return null;
  const id = hit.kitsuId
    ? `kitsu:${hit.kitsuId}`
    : hit.malId
      ? `mal:${hit.malId}`
      : hit.anilistId
        ? `anilist:${hit.anilistId}`
        : null;
  if (!id) return null;
  const meta = {
    id,
    type: "anime",
    name: hit.name,
    poster: hit.poster ?? undefined,
    background: hit.background ?? hit.poster ?? undefined,
    description: hit.overview,
    releaseInfo: hit.year ?? undefined,
    imdbRating: hit.score > 0 ? hit.score.toFixed(1) : undefined,
    malId: hit.malId || undefined,
    animeFormat: hit.format ?? undefined,
  } as Meta;
  return {
    kind: "series",
    meta,
    popularity: 0,
    backdrop: hit.background ?? hit.poster ?? undefined,
    overview: hit.overview,
    voteAverage: hit.score > 0 ? hit.score : undefined,
  };
}

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
