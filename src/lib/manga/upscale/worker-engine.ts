/// <reference lib="webworker" />

import * as ort from "onnxruntime-web/webgpu";
import ortWasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url";
import ortMjsUrl from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url";
import type { MangaQuality } from "./protocol";

ort.env.wasm.wasmPaths = { wasm: ortWasmUrl, mjs: ortMjsUrl };
// No cross-origin isolation in the Tauri webview, so threaded wasm would spawn
// nested workers that cannot start. WebGPU does not need them.
ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;
ort.env.wasm.simd = true;

let session: ort.InferenceSession | null = null;
let activeProvider: "webgpu" | "wasm" | null = null;
let activeKey: string | null = null;
let activeQuality: MangaQuality | null = null;

export function mangaProvider(): "webgpu" | "wasm" | null {
  return activeProvider;
}

function releaseSession() {
  if (!session) return;
  (session as unknown as { release?: () => void }).release?.();
  session = null;
  activeProvider = null;
  activeKey = null;
  activeQuality = null;
}

export async function ensureMangaSession(
  model: ArrayBuffer,
  quality: MangaQuality,
  key: string,
): Promise<void> {
  if (session && activeKey === key && activeQuality === quality) return;
  releaseSession();
  const bytes = new Uint8Array(model);
  const webgpu = typeof navigator !== "undefined" && "gpu" in navigator;
  if (webgpu) {
    try {
      session = await ort.InferenceSession.create(bytes, {
        executionProviders: ["webgpu"],
        graphOptimizationLevel: "all",
      });
      activeProvider = "webgpu";
      activeKey = key;
      activeQuality = quality;
      console.info(`[manga-upscale] ${quality} model using WebGPU`);
      return;
    } catch (error) {
      // Older WebKit and driverless adapters fail here; wasm still works.
      console.warn("[manga-upscale] WebGPU unavailable:", error);
    }
  }
  session = await ort.InferenceSession.create(bytes, {
    executionProviders: ["wasm"],
    graphOptimizationLevel: "all",
  });
  activeProvider = "wasm";
  activeKey = key;
  activeQuality = quality;
  console.info(`[manga-upscale] ${quality} model using WebAssembly`);
}

// Tiles keep each GPU dispatch short and the working set small. Without this a
// page-sized inference stalls the desktop compositor for the whole run. The
// heavy MangaJaNai model falls off a cliff above ~0.4 MP per dispatch, so it
// uses smaller tiles and a wider overlap for its larger receptive field.
const TILE: Record<MangaQuality, number> = { fast: 768, best: 512 };
const OVERLAP: Record<MangaQuality, number> = { fast: 32, best: 64 };
const SCALE: Record<MangaQuality, number> = { fast: 2, best: 2 };

async function runTile(
  current: ort.InferenceSession,
  image: ImageData,
  scale: number,
): Promise<ImageData> {
  const width = image.width;
  const height = image.height;
  const plane = width * height;
  const pixels = image.data;

  const input = new Float32Array(3 * plane);
  for (let i = 0, p = 0; i < pixels.length; i += 4, p++) {
    input[p] = pixels[i] / 255;
    input[plane + p] = pixels[i + 1] / 255;
    input[2 * plane + p] = pixels[i + 2] / 255;
  }

  const tensor = new ort.Tensor("float32", input, [1, 3, height, width]);
  try {
    const outputs = await current.run({ [current.inputNames[0]]: tensor });
    try {
      const values = outputs[current.outputNames[0]].data as Float32Array;
      const outWidth = width * scale;
      const outHeight = height * scale;
      const outPlane = outWidth * outHeight;
      const rgba = new Uint8ClampedArray(outPlane * 4);
      for (let i = 0; i < outPlane; i++) {
        rgba[i * 4] = values[i] * 255;
        rgba[i * 4 + 1] = values[outPlane + i] * 255;
        rgba[i * 4 + 2] = values[outPlane * 2 + i] * 255;
        rgba[i * 4 + 3] = 255;
      }
      return new ImageData(rgba, outWidth, outHeight);
    } finally {
      for (const value of Object.values(outputs)) value.dispose();
    }
  } finally {
    tensor.dispose();
  }
}

export async function upscaleBitmap(bitmap: ImageBitmap, quality: MangaQuality): Promise<Blob> {
  const current = session;
  if (!current) throw new Error("Manga upscaler is not loaded");
  const tile = TILE[quality];
  const overlap = OVERLAP[quality];
  const scale = SCALE[quality];

  const width = bitmap.width;
  const height = bitmap.height;
  const target = new OffscreenCanvas(width * scale, height * scale);
  const targetContext = target.getContext("2d");
  if (!targetContext) throw new Error("Canvas is unavailable");

  for (let y = 0; y < height; y += tile) {
    for (let x = 0; x < width; x += tile) {
      const left = Math.max(0, x - overlap);
      const top = Math.max(0, y - overlap);
      const right = Math.min(width, x + tile + overlap);
      const bottom = Math.min(height, y + tile + overlap);
      const tileWidth = right - left;
      const tileHeight = bottom - top;
      // Both models finish with a pixel shuffle that needs an aligned size.
      const padWidth = (scale - (tileWidth % scale)) % scale;
      const padHeight = (scale - (tileHeight % scale)) % scale;
      const paddedWidth = tileWidth + padWidth;
      const paddedHeight = tileHeight + padHeight;

      const source = new OffscreenCanvas(paddedWidth, paddedHeight);
      const sourceContext = source.getContext("2d", { willReadFrequently: true });
      if (!sourceContext) throw new Error("Canvas is unavailable");
      sourceContext.drawImage(
        bitmap,
        left,
        top,
        tileWidth,
        tileHeight,
        0,
        0,
        tileWidth,
        tileHeight,
      );
      // Replicate the last column/row instead of leaving a black edge.
      if (padWidth)
        sourceContext.drawImage(
          source,
          tileWidth - 1,
          0,
          1,
          tileHeight,
          tileWidth,
          0,
          padWidth,
          tileHeight,
        );
      if (padHeight)
        sourceContext.drawImage(
          source,
          0,
          tileHeight - 1,
          paddedWidth,
          1,
          0,
          tileHeight,
          paddedWidth,
          padHeight,
        );

      const out = await runTile(
        current,
        sourceContext.getImageData(0, 0, paddedWidth, paddedHeight),
        scale,
      );

      // Drop the overlap and place only the tile's own region in the result. The
      // model is convolutional, so the shared border matches its neighbours.
      const cropX = (x - left) * scale;
      const cropY = (y - top) * scale;
      const cropWidth = Math.min(tile, width - x) * scale;
      const cropHeight = Math.min(tile, height - y) * scale;
      targetContext.putImageData(
        out,
        x * scale - cropX,
        y * scale - cropY,
        cropX,
        cropY,
        cropWidth,
        cropHeight,
      );
    }
  }

  return await target.convertToBlob({ type: "image/png" });
}
