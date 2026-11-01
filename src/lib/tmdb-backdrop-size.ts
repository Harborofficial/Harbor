/** Normalize TMDB-style image paths without changing unrelated image URLs. */
export type TmdbBackdropSize = "w300" | "w780" | "w1280" | "original";

export function tmdbBackdropAtSize(url: string, size: TmdbBackdropSize): string {
  return url.replace(/\/t\/p\/(w\d+|h\d+|original)\//, `/t/p/${size}/`);
}
