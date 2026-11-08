export const MAX_PAGE_PIXELS = 1_200_000;
// Tall webtoon strips are still one page. 9 MP covers the common 720-800 px
// wide strips while keeping the 2x result under ~150 MB.
export const MAX_GPU_PAGE_PIXELS = 9_000_000;
export const MIN_STRETCH = 1.05;
export const MIN_PAGE_WIDTH = 200;

/** Only pay for pages the browser is actually stretching: small scans, or zoomed views. */
export function shouldUpscale({
  naturalWidth,
  naturalHeight,
  renderedWidth,
  dpr,
  maxPixels = MAX_PAGE_PIXELS,
}: {
  naturalWidth: number;
  naturalHeight: number;
  renderedWidth: number;
  dpr: number;
  maxPixels?: number;
}): boolean {
  if (naturalWidth < MIN_PAGE_WIDTH || naturalHeight <= 0 || renderedWidth <= 0) return false;
  if (naturalWidth * naturalHeight > maxPixels) return false;
  return naturalWidth * MIN_STRETCH <= renderedWidth * Math.min(dpr, 2);
}
