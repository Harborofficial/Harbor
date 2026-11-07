// Keep the card-specific anime ID set aligned with PosterCard's original support.
const CARD_ANIME_ID = /^(kitsu|mal|anilist|anidb):/;

export function isCardAnimeId(id: string): boolean {
  return CARD_ANIME_ID.test(id);
}
