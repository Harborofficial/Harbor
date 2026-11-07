/** A poster-service image is already part of the tile, so the card must not draw its title again. */
export function bpPosterOverride(
  src: string | undefined,
  poster: string | undefined,
  customArt: boolean,
): { src: string | undefined; custom: boolean } {
  const url = src && src !== poster ? src : undefined;
  return { src: url, custom: Boolean(url) && customArt };
}
