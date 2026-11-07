const MIN_WIDTH = 1600;
const MIN_HEIGHT = 800;
const MIN_RATIO = 1.45;
// 21:9 is the widest a hero crop can take without letterboxing the subject out.
const MAX_RATIO = 2.4;

/**
 * Anime sources can return 4:1 promo strips (AniList banners, many Kitsu covers) that look
 * sharp in a card but turn to mush across a full-screen hero. Measuring the decoded image is
 * the only reliable quality signal because the URLs do not carry dimensions.
 */
export function isHighQualityHeroArt(width: number, height: number): boolean {
  const ratio = height > 0 ? width / height : 0;
  return width >= MIN_WIDTH && height >= MIN_HEIGHT && ratio >= MIN_RATIO && ratio <= MAX_RATIO;
}

const measured = new Map<string, boolean>();

export function rememberHeroArtQuality(url: string, width: number, height: number): void {
  measured.set(url, isHighQualityHeroArt(width, height));
  while (measured.size > 400) {
    const oldest = measured.keys().next().value;
    if (oldest === undefined) break;
    measured.delete(oldest);
  }
}

export function knownHeroArtQuality(url: string): boolean | undefined {
  return measured.get(url);
}

/** First candidate not already known to be unsuitable; unknown art is still worth trying. */
export function firstUsableHeroBackdrop(urls: string[]): string | undefined {
  return urls.find((url) => knownHeroArtQuality(url) !== false);
}

/** The next candidate after an image was measured as unsuitable, if any. */
export function nextUsableHeroBackdrop(urls: string[], current: string): string | undefined {
  const at = urls.indexOf(current);
  if (at < 0) return urls.find((url) => knownHeroArtQuality(url) !== false);
  for (let index = at + 1; index < urls.length; index += 1) {
    if (knownHeroArtQuality(urls[index]) !== false) return urls[index];
  }
  return undefined;
}
