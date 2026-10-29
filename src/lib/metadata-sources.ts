import type { Addon } from "./addons";
import { metadataAddonKey } from "./metadata-addons";

export type MetadataSourceSection =
  | "title"
  | "description"
  | "seasonSynopsis"
  | "poster"
  | "seasonPoster"
  | "backdrop"
  | "logo"
  | "episodes"
  | "ratings"
  | "cast"
  | "trailers"
  | "search";

export type MetadataSourceChain = Partial<Record<MetadataSourceSection, string[]>>;

export function posterTransformEnabled(settings: {
  addonOnlyMetadata?: boolean;
  metadataSources?: MetadataSourceChain;
}): boolean {
  const chain = settings.metadataSources?.poster;
  if (!settings.addonOnlyMetadata || !chain?.length) return true;
  const transform = chain.findIndex((id) => id === "rpdb" || id === "posterService");
  if (transform < 0) return false;
  const source = chain.findIndex((id) => id !== "rpdb" && id !== "posterService");
  return source < 0 || transform < source;
}

export function posterTransformEnabledFromStorage(): boolean {
  try {
    const settings = JSON.parse(localStorage.getItem("harbor.settings") ?? "{}") as {
      addonOnlyMetadata?: boolean;
      metadataSources?: MetadataSourceChain;
    };
    return posterTransformEnabled(settings);
  } catch {
    return true;
  }
}

export type MetadataSourceSettings = {
  tmdbKey: string;
  tvdbKey: string;
  fanartKey: string;
  omdbKey: string;
  mdblistKey: string;
  rpdbKey: string;
  posterBaseUrl: string;
};

export type MetadataSourceOption = {
  id: string;
  name: string;
  kind: "Addon" | "Key" | "Transform";
};

export const METADATA_SOURCE_SECTIONS: Array<{
  id: MetadataSourceSection;
  label: string;
  description: string;
}> = [
  { id: "poster", label: "Posters", description: "Title poster art and poster transforms." },
  { id: "title", label: "Titles", description: "Main title shown across the detail page." },
  { id: "description", label: "Descriptions", description: "Short and full title descriptions." },
  { id: "ratings", label: "Ratings", description: "IMDb, Trakt and audience scores." },
  { id: "backdrop", label: "Backdrop", description: "Hero and season backgrounds." },
  { id: "logo", label: "Logos", description: "Clear logo art used in the hero." },
  {
    id: "seasonPoster",
    label: "Season Posters",
    description: "Poster art used by the season rail.",
  },
  {
    id: "seasonSynopsis",
    label: "Season Synopsis",
    description: "Season-level text. Empty values fall through.",
  },
  {
    id: "episodes",
    label: "Episode and Seasons",
    description: "One source owns episode and season numbering.",
  },
  { id: "cast", label: "Cast", description: "Cast shown in the About panel." },
  { id: "trailers", label: "Trailers", description: "Trailer videos shown on the details page." },
  {
    id: "search",
    label: "Search / Top Match",
    description: "Addon and TMDB order used by search results and Top Match.",
  },
];

const ADDON_SOURCE_PREFIX = "addon:";

export function addonSourceId(key: string): string {
  return `${ADDON_SOURCE_PREFIX}${key}`;
}

export function addonKeyFromSource(id: string): string | null {
  return id.startsWith(ADDON_SOURCE_PREFIX) ? id.slice(ADDON_SOURCE_PREFIX.length) : null;
}

export function addonSourceOptions(addons: Addon[]): MetadataSourceOption[] {
  return addons.map((addon) => ({
    id: addonSourceId(metadataAddonKey(addon)),
    name: addon.manifest.name,
    kind: "Addon",
  }));
}

function providerOptions(settings: MetadataSourceSettings): MetadataSourceOption[] {
  const options: MetadataSourceOption[] = [];
  if (settings.tmdbKey.trim()) options.push({ id: "tmdb", name: "TMDB", kind: "Key" });
  if (settings.tvdbKey.trim()) options.push({ id: "tvdb", name: "TheTVDB", kind: "Key" });
  if (settings.fanartKey.trim()) options.push({ id: "fanart", name: "Fanart.tv", kind: "Key" });
  if (settings.omdbKey.trim()) options.push({ id: "omdb", name: "OMDb", kind: "Key" });
  if (settings.mdblistKey.trim()) options.push({ id: "mdblist", name: "MDBList", kind: "Key" });
  if (settings.rpdbKey.trim()) options.push({ id: "rpdb", name: "RPDB", kind: "Transform" });
  if (settings.posterBaseUrl.trim())
    options.push({ id: "posterService", name: "Custom poster service", kind: "Transform" });
  return options;
}

const SECTION_PROVIDERS: Record<MetadataSourceSection, string[]> = {
  title: ["tmdb"],
  description: ["tmdb"],
  seasonSynopsis: ["tmdb", "tvdb"],
  poster: ["fanart", "tmdb", "rpdb", "posterService"],
  seasonPoster: ["fanart", "tmdb"],
  backdrop: ["fanart", "tmdb"],
  logo: ["fanart", "tmdb"],
  episodes: ["tvdb", "tmdb"],
  ratings: ["omdb", "mdblist", "tmdb"],
  cast: ["tmdb"],
  trailers: ["tmdb"],
  search: ["tmdb"],
};

export function metadataSourceOptions(
  section: MetadataSourceSection,
  addons: Addon[],
  settings: MetadataSourceSettings,
): MetadataSourceOption[] {
  const providers = new Map(providerOptions(settings).map((option) => [option.id, option]));
  return [
    ...addonSourceOptions(addons),
    ...SECTION_PROVIDERS[section].flatMap((id) => {
      const option = providers.get(id);
      return option ? [option] : [];
    }),
  ];
}

export function defaultMetadataSourceChain(
  section: MetadataSourceSection,
  addons: Addon[],
  settings: MetadataSourceSettings,
): string[] {
  return metadataSourceOptions(section, addons, settings).map((option) => option.id);
}

export function metadataSourceName(
  id: string,
  addons: Addon[],
  settings: MetadataSourceSettings,
): string {
  const addonKey = addonKeyFromSource(id);
  if (addonKey) {
    const addon = addons.find((item) => metadataAddonKey(item) === addonKey);
    return addon?.manifest.name ?? addonKey;
  }
  return providerOptions(settings).find((option) => option.id === id)?.name ?? id;
}

export function metadataSourceKind(
  id: string,
  addons: Addon[],
  settings: MetadataSourceSettings,
): MetadataSourceOption["kind"] | null {
  const addonKey = addonKeyFromSource(id);
  if (addonKey) return addons.some((item) => metadataAddonKey(item) === addonKey) ? "Addon" : null;
  return providerOptions(settings).find((option) => option.id === id)?.kind ?? null;
}

export function normalizeMetadataSourceChain(
  section: MetadataSourceSection,
  chain: string[] | undefined,
  addons: Addon[],
  settings: MetadataSourceSettings,
): string[] {
  const available = new Set(
    metadataSourceOptions(section, addons, settings).map((option) => option.id),
  );
  const kept = (chain ?? []).filter(
    (id, index) => available.has(id) && (chain ?? []).indexOf(id) === index,
  );
  const defaults = defaultMetadataSourceChain(section, addons, settings);
  return [...kept, ...defaults.filter((id) => !kept.includes(id))];
}
