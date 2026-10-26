import type { AnimeDetailExtras } from "./anime-detail";
import type { TmdbDetail } from "./tmdb";

/** Supplementary metadata fills the base without erasing usable values. */
export function mergeAnimeDetailExtras(base: TmdbDetail, patch: AnimeDetailExtras): TmdbDetail {
  let result = base;
  for (const key of Object.keys(patch) as (keyof AnimeDetailExtras)[]) {
    let value = patch[key];
    if (value == null || value === "" || (Array.isArray(value) && value.length === 0)) continue;
    if (key === "gallery" && patch.gallery) {
      const gallery = patch.gallery;
      value = {
        backdrops: [...new Set([...base.gallery.backdrops, ...gallery.backdrops])],
        posters: [...new Set([...base.gallery.posters, ...gallery.posters])],
        logos: [...new Set([...base.gallery.logos, ...gallery.logos])],
      };
      if (
        Object.keys(gallery).every((k) => {
          const field = k as keyof typeof gallery;
          const next = (value as typeof gallery)[field];
          return (
            next.length === base.gallery[field].length &&
            next.every((item, i) => item === base.gallery[field][i])
          );
        })
      )
        continue;
    }
    if (value === base[key as keyof TmdbDetail]) continue;
    if (Array.isArray(value)) {
      const previous = base[key as keyof TmdbDetail];
      if (
        Array.isArray(previous) &&
        previous.length === value.length &&
        value.every((item, i) => item === previous[i])
      )
        continue;
    }
    if (result === base) result = { ...base };
    Object.assign(result, { [key]: value });
  }
  return result;
}
