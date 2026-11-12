export type PdfRenderLimits = {
  maxWidth: number;
  maxHeight: number;
  maxPixels: number;
  maxSide: number;
  maxScale: number;
};

export const PDF_RENDER_LIMITS: PdfRenderLimits = {
  maxWidth: 1600,
  maxHeight: 6000,
  maxPixels: 8_000_000,
  maxSide: 8192,
  maxScale: 2,
};

export type PdfRenderSize = {
  width: number;
  height: number;
  scale: number;
};

/**
 * PDF page dimensions are untrusted. Choose one scale that satisfies width,
 * height, side and total-pixel limits before any canvas is allocated. There is
 * deliberately no minimum scale: an oversized page must shrink, not fail or
 * allocate gigabytes.
 */
export function pageRenderSize(
  width: number,
  height: number,
  limits: PdfRenderLimits = PDF_RENDER_LIMITS,
): PdfRenderSize {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error("The PDF page has invalid dimensions");
  }
  const scale = Math.min(
    limits.maxScale,
    limits.maxWidth / width,
    limits.maxHeight / height,
    Math.sqrt(limits.maxPixels / (width * height)),
    limits.maxSide / width,
    limits.maxSide / height,
  );
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new Error("The PDF page is too large to render");
  }
  return {
    width: Math.max(1, Math.min(limits.maxSide, Math.floor(width * scale))),
    height: Math.max(1, Math.min(limits.maxSide, Math.floor(height * scale))),
    scale,
  };
}
