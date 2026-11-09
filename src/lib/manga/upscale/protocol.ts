export type MangaQuality = "fast" | "best";

export type MangaUpscaleRequest =
  | { id: number; type: "ensure"; quality: MangaQuality; modelKey: string; model: ArrayBuffer }
  | { id: number; type: "upscale"; quality: MangaQuality; bitmap: ImageBitmap };

export type MangaUpscaleResponse =
  | { id: number; ok: true; result?: Blob; provider?: "webgpu" | "wasm" }
  | { id: number; ok: false; error: string };
