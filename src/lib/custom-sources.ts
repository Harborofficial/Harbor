export type CatalogSource = {
  addonId: string;
  type: string;
  catalogId: string;
};

export type NativeSource = {
  title: string;
  sortBy?: string;
  filters?: Record<string, any>;
  provider: string;
  mediaType: string;
  tmdbSourceType?: string;
  tmdbId?: string | number | null;
  traktListId?: string | number | null;
};

export type SourceFolder = {
  id: string;
  title: string;
  coverImageUrl: string | null;
  focusGifUrl: string | null;
  coverEmoji?: string | null;
  tileShape: "LANDSCAPE" | "POSTER";
  layout?: "CLASSIC" | "GRID";
  hideTitle?: boolean;
  catalogSources?: CatalogSource[];
  sources?: NativeSource[];
  _coverMode?: "image" | "emoji" | string;
};

export type SourceRow = {
  id: string;
  title: string;
  backdropImageUrl?: string | null;
  pinToTop?: boolean;
  focusGlowEnabled?: boolean;
  viewMode?: string;
  showAllTab?: boolean;
  folders: SourceFolder[];
};

export function isValidSourceRow(data: any): data is SourceRow {
  if (!data || typeof data !== "object") return false;
  if (typeof data.id !== "string" || typeof data.title !== "string") return false;
  if (!Array.isArray(data.folders) || data.folders.length === 0) return false;

  for (const folder of data.folders) {
    if (!folder || typeof folder !== "object") return false;
    if (typeof folder.id !== "string" || typeof folder.title !== "string") return false;
    if (folder.tileShape !== "LANDSCAPE" && folder.tileShape !== "POSTER") return false;

    const hasCatalogSources = Array.isArray(folder.catalogSources) && folder.catalogSources.length > 0;
    const hasNativeSources = Array.isArray(folder.sources) && folder.sources.length > 0;

    if (!hasCatalogSources && !hasNativeSources) return false;

    if (hasCatalogSources) {
      for (const source of folder.catalogSources!) {
        if (!source || typeof source !== "object") return false;
        if (typeof source.addonId !== "string" || typeof source.type !== "string" || typeof source.catalogId !== "string") {
          return false;
        }
      }
    }

    if (hasNativeSources) {
      for (const source of folder.sources!) {
        if (!source || typeof source !== "object") return false;
        if (typeof source.provider !== "string" || typeof source.mediaType !== "string") {
          return false;
        }
      }
    }
  }

  return true;
}

export function folderLayout(
  customSources: SourceRow[],
  sourceId: string,
  folderId: string,
): SourceFolder["layout"] {
  return customSources
    .find((row) => row.id === sourceId)
    ?.folders.find((f) => f.id === folderId)?.layout;
}

export function updateSourceFolder(
  customSources: SourceRow[],
  sourceId: string,
  folderId: string,
  updates: Partial<SourceFolder>,
): SourceRow[] {
  return customSources.map((sr) =>
    sr.id === sourceId && sr.folders.some((f) => f.id === folderId)
      ? {
          ...sr,
          folders: sr.folders.map((f) => (f.id === folderId ? { ...f, ...updates } : f)),
        }
      : sr,
  );
}

export function tmdbSourceParams(
  source: Pick<NativeSource, "sortBy" | "filters" | "mediaType" | "tmdbSourceType" | "tmdbId">,
  page: number,
): Record<string, string> {
  const params: Record<string, string> = { page: String(page) };
  if (source.sortBy) params["sort_by"] = source.sortBy;
  for (const [k, v] of Object.entries(source.filters ?? {})) {
    if (k === "year") {
      params[source.mediaType === "TV" ? "first_air_date_year" : "primary_release_year"] =
        String(v);
    } else if (k === "voteCountGte") {
      params["vote_count.gte"] = String(v);
    } else if (k === "voteAverageGte") {
      params["vote_average.gte"] = String(v);
    } else {
      params[k.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)] = String(v);
    }
  }
  if (source.tmdbSourceType === "COMPANY" && source.tmdbId) {
    params["with_companies"] = String(source.tmdbId);
  }
  return params;
}

export function parseSourceRows(jsonString: string): SourceRow[] {
  try {
    const data = JSON.parse(jsonString);
    if (Array.isArray(data)) {
      return data.filter(isValidSourceRow);
    } else if (isValidSourceRow(data)) {
      return [data];
    }
    return [];
  } catch {
    return [];
  }
}
