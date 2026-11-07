/**
 * Anime artwork arrives from sources with very different quality. Curated hero art, TMDB
 * originals, and TVDB backgrounds are real 16:9 art. AniList banners are 1900x400, and Kitsu
 * covers are sometimes 1920x1080 but often 3-4:1 strips (One Piece is 1464x365, Cyberpunk
 * 1920x492). A full-screen hero upscales those strips until they look softer than the
 * backdrops movies and series use, so they belong at the end of the queue.
 */
const ANILIST_BANNER = /anilistcdn\/media\/anime\/banner\//i;
// Kitsu "covers" are 16:9 for some entries and 3-4:1 strips for others (One Piece is
// 1464x365, Cyberpunk 1920x492), so they must not be reused as cached hero art.
const KITSU_COVER = /media\.kitsu\.(?:app|io)\/anime\/(?:cover_images|[^/]+\/cover_image)\//i;

export function isAnilistBannerBackdrop(url: string | undefined): boolean {
  return !!url && ANILIST_BANNER.test(url);
}

function isCachedHeroArtUnreliable(url: string | undefined): boolean {
  return isAnilistBannerBackdrop(url) || (!!url && KITSU_COVER.test(url));
}

export type AnimeHeroBackdropSources = {
  curated?: string;
  tvdb?: string;
  tmdb?: string;
  kitsu?: string;
  banner?: string;
};

export function pickAnimeHeroBackdrop(sources: AnimeHeroBackdropSources): string | undefined {
  const quality = [sources.curated, sources.tmdb, sources.tvdb, sources.kitsu].find(
    (url): url is string => !!url && !isAnilistBannerBackdrop(url),
  );
  return (
    quality ?? sources.banner ?? sources.curated ?? sources.kitsu ?? sources.tmdb ?? sources.tvdb
  );
}

/** Cached hero art is shared by the detail page, home hero, and download dialog. A cached
 *  banner or wide Kitsu strip must not win over art those surfaces can still resolve. */
export function reusableAnimeBackdrop(url: string | undefined): string | undefined {
  return isCachedHeroArtUnreliable(url) ? undefined : url;
}
