// The fast tier. MangaJaNai is the better model but takes seconds per page on a
// GPU; this one is small enough to run while reading. Models are downloaded on
// demand, so the app stays small and the licence travels with the model.
export const MANGA_UPSCALE_MODEL = {
  id: "waifu2x-upconv7-2x",
  name: "Fast 2x",
  url: "https://huggingface.co/lookx2/waifu2x_upconv7/resolve/main/waifu2x_upconv7_anime_noise1_2x.onnx",
  bytes: 2_212_306,
  sha256: "17194ab8e06454fab7271fd29700023bb56252643dbfe6879178c22fd0ebe8fc",
  license: "MIT",
  source: "https://huggingface.co/lookx2/waifu2x_upconv7",
} as const;

export const MODEL_CACHE = "harbor.manga.upscale.model.v1";
export const PAGE_CACHE = "harbor.manga.upscale.pages.v1";
export const BEST_MODEL_CACHE = "harbor.manga.upscale.best.model.v1";
export const BEST_PAGE_CACHE = "harbor.manga.upscale.best.pages.v3";

// MangaJaNai V1 is one model per source height, so halftone dots come out at
// the right frequency. Every file is the same size.
export const BEST_MODEL_BYTES = 67_191_396;
const BEST_EPOCHS: Record<number, number> = {
  1200: 70,
  1300: 75,
  1400: 70,
  1500: 90,
  1600: 90,
  1920: 70,
  2048: 95,
};

export const BEST_HEIGHTS = Object.keys(BEST_EPOCHS)
  .map(Number)
  .sort((a, b) => a - b);

export function bestModelUrl(height: number): string {
  return `https://huggingface.co/haesslerian/MangaJaNai_V1_ONNX/resolve/main/2x_MangaJaNai_${height}p_V1_ESRGAN_${BEST_EPOCHS[height]}k.onnx`;
}

export function nearestBestHeight(height: number): number {
  let best = BEST_HEIGHTS[0];
  for (const candidate of BEST_HEIGHTS) {
    if (Math.abs(candidate - height) < Math.abs(best - height)) best = candidate;
  }
  return best;
}
