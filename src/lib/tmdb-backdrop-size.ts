/** Normalize TMDB-style image paths without changing unrelated image URLs. */
export type TmdbBackdropSize = "w300" | "w780" | "w1280" | "original";

const TMDB_RUNG = /\/t\/p\/(w\d+|h\d+|original)\//;

export function tmdbBackdropAtSize(url: string, size: TmdbBackdropSize): string {
  // Other hosts can serve a /t/p/<size>/ path of their own, so match on the host too.
  try {
    if (new URL(url).hostname.toLowerCase() !== "image.tmdb.org") return url;
  } catch {
    return url;
  }
  return url.replace(TMDB_RUNG, `/t/p/${size}/`);
}
