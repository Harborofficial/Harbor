export function isAnimeMetaId(id: string | null | undefined): boolean {
  return !!id && /^(kitsu|mal|anilist|anidb):/.test(id);
}

/**
 * Harbor's TVDB proxy is for anime. Regular titles must bring their own key.
 * Meta can identify an anime through its provider id, type, or format.
 */
export function isAnimeMeta(
  meta: { id?: string | null; type?: string; animeFormat?: string } | null | undefined,
): boolean {
  return isAnimeMetaId(meta?.id) || meta?.type === "anime" || !!meta?.animeFormat;
}
