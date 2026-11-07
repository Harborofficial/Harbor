export function validImdbRating(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 && number <= 10 ? number.toFixed(1) : undefined;
}

export async function fetchDetailImdbRating(
  id: string,
  kind: "movie" | "series",
  fetchMeta: (
    kind: "movie" | "series",
    id: string,
    force: boolean,
  ) => Promise<{ imdbRating?: unknown } | null>,
): Promise<string | undefined> {
  if (!/^tt\d+$/.test(id)) return undefined;
  // The title/description provider toggle is independent of the IMDb detail badge.
  return validImdbRating((await fetchMeta(kind, id, true))?.imdbRating);
}

export function chainedPrimaryRating(input: {
  chain?: string[];
  sourceRatings?: Record<string, string>;
  omdb?: unknown;
  detail?: unknown;
  fallback?: unknown;
}): { value?: string; source: "imdb" | "tmdb" } {
  for (const id of input.chain ?? []) {
    if (id === "omdb") {
      const value = validImdbRating(input.omdb);
      if (value) return { value, source: "imdb" };
      continue;
    }
    if (id === "tmdb") {
      const value = validImdbRating(input.sourceRatings?.tmdb);
      if (value) return { value, source: "tmdb" };
      continue;
    }
    if (id.startsWith("addon:")) {
      const value = validImdbRating(input.sourceRatings?.[id]);
      if (value) return { value, source: "imdb" };
    }
  }
  const imdb = validImdbRating(input.fallback);
  return imdb
    ? { value: imdb, source: "imdb" }
    : { value: validImdbRating(input.detail), source: "tmdb" };
}

export function detailImdbRating(input: {
  id: string;
  inline?: unknown;
  fullId?: string;
  full?: unknown;
  detailId?: string | null;
  detail?: unknown;
  detailSource?: "imdb" | "tmdb";
  cinemeta?: unknown;
  omdb?: unknown;
  harbor?: unknown;
}): string | undefined {
  const imdbId = input.id.startsWith("tt") ? input.id : input.detailId;
  // Services first, matching the order the shared src/lib/imdb-rating.ts uses for the hero cards, so
  // one title cannot show two different IMDb numbers. The metadata terms stay as fallbacks.
  const candidates = [
    input.harbor,
    input.omdb,
    input.cinemeta,
    input.id.startsWith("tt") ? input.inline : undefined,
    imdbId && input.fullId === imdbId ? input.full : undefined,
    imdbId && input.detailSource === "imdb" && input.detailId === imdbId ? input.detail : undefined,
  ];
  for (const value of candidates) {
    const rating = validImdbRating(value);
    if (rating) return rating;
  }
  return undefined;
}
