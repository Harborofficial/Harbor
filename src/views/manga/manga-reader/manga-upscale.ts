import { cachedMangaPage, isMangaUpscalerActive, upscaleMangaPage } from "@/lib/manga/upscale";
import { MAX_GPU_PAGE_PIXELS, MIN_STRETCH } from "@/lib/manga/upscale/eligibility";
import {
  bestModelInstalled,
  cachedBestPage,
  chapterBestHeight,
  downloadBestModel,
  isBestUpscalerActive,
  upscaleBestPage,
} from "@/lib/manga/upscale/best";
import { fetchImageObjectUrl, IMAGE_FALLBACK_HEADERS } from "./reader-utils";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const dev = import.meta.env.DEV;
let lastRenderedWidth = 0;

export function noteRenderedPageWidth(width: number) {
  if (width > 0) lastRenderedWidth = width;
}

// Sources that do not send CORS only need to fail once; every later page from
// the same origin goes straight to the Harbor fetch.
const corsBlocked = new Set<string>();
const blobReads = new Map<string, Promise<Blob | null>>();
// Keep the last few original pages so the high-quality pass does not download
// the same source a second time.
const sourceBlobs = new Map<string, Blob>();
const SOURCE_BLOBS_MAX = 6;

function rememberSource(url: string, blob: Blob) {
  sourceBlobs.delete(url);
  sourceBlobs.set(url, blob);
  while (sourceBlobs.size > SOURCE_BLOBS_MAX) {
    const oldest = sourceBlobs.keys().next().value;
    if (!oldest) break;
    sourceBlobs.delete(oldest);
  }
}

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

function isCleanSource(src: string): boolean {
  if (src.startsWith("blob:") || src.startsWith("data:")) return true;
  try {
    return new URL(src, location.href).origin === location.origin;
  } catch {
    return false;
  }
}

export async function readBlob(
  url: string,
  headers?: Record<string, string>,
): Promise<Blob | null> {
  const remembered = sourceBlobs.get(url);
  if (remembered) return remembered;
  const running = blobReads.get(url);
  if (running) return running;

  const task = (async (): Promise<Blob | null> => {
    const origin = originOf(url);
    if (!corsBlocked.has(origin)) {
      try {
        const response = await fetch(url, { mode: "cors", credentials: "omit" });
        const blob = response.ok ? await response.blob() : null;
        if (blob?.type.startsWith("image/")) {
          if (dev) console.info("[manga-upscale] pixels via CORS fetch");
          return blob;
        }
      } catch (error) {
        if (dev) console.warn("[manga-upscale] CORS fetch failed", error);
      }
      corsBlocked.add(origin);
    }

    if (!isTauri) return null;
    let objectUrl: string | null = null;
    try {
      objectUrl = await fetchImageObjectUrl(
        url,
        headers && Object.keys(headers).length ? headers : IMAGE_FALLBACK_HEADERS,
      );
      const response = await fetch(objectUrl);
      const blob = await response.blob();
      if (blob.type.startsWith("image/")) {
        if (dev) console.info("[manga-upscale] pixels via Harbor fetch");
        return blob;
      }
    } catch (error) {
      if (dev) console.warn("[manga-upscale] Harbor fetch failed", error);
    } finally {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    }
    return null;
  })();

  blobReads.set(url, task);
  try {
    const blob = await task;
    if (blob) rememberSource(url, blob);
    return blob;
  } finally {
    blobReads.delete(url);
  }
}

/**
 * Gets origin-clean page bytes for the upscaler. A cross-origin `<img>`
 * produces a tainted bitmap that cannot cross the worker boundary, so only
 * blob, data and same-origin images use the element's own source.
 */
export async function readableBlob(
  img: HTMLImageElement | null,
  url: string,
  headers?: Record<string, string>,
): Promise<Blob | null> {
  const src = img?.currentSrc || img?.src;
  if (src && isCleanSource(src)) {
    try {
      const response = await fetch(src);
      if (response.ok) {
        const blob = await response.blob();
        if (blob.type.startsWith("image/")) {
          rememberSource(url, blob);
          return blob;
        }
      }
    } catch (error) {
      if (dev) console.warn("[manga-upscale] clean fetch failed", error);
    }
  }
  return readBlob(url, headers);
}

/** A page is color only when a meaningful share of its mid-tones carry
 *  chroma. Paper tint and JPEG chroma noise on B&W scans stay below this. */
export function isColorBitmap(bitmap: ImageBitmap): boolean {
  const size = 64;
  const canvas = new OffscreenCanvas(size, size);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return false;
  context.drawImage(bitmap, 0, 0, size, size);
  const data = context.getImageData(0, 0, size, size).data;
  const total = size * size;
  let colored = 0;
  for (let i = 0; i < data.length; i += 4) {
    const max = Math.max(data[i], data[i + 1], data[i + 2]);
    const min = Math.min(data[i], data[i + 1], data[i + 2]);
    if (max < 28 || min > 232) continue;
    const chroma = max - min;
    const saturation = max === 0 ? 0 : chroma / max;
    if (chroma > 45 && saturation > 0.25) colored++;
  }
  return colored > total * 0.02;
}

export async function isColorPage(blob: Blob): Promise<boolean> {
  const bitmap = await createImageBitmap(blob);
  try {
    return isColorBitmap(bitmap);
  } finally {
    bitmap.close();
  }
}

/** Warms the next page with the high-quality model, when it is worth doing. */
export async function prefetchBestMangaPage(
  url: string,
  headers: Record<string, string> | undefined,
  key = url,
  autoDownload = false,
): Promise<void> {
  if (!url) return;
  if (!isBestUpscalerActive()) return;
  try {
    if (await cachedBestPage(key)) return;
    const blob = await readBlob(url, headers);
    if (!blob) return;
    const bitmap = await createImageBitmap(blob);
    let height = 0;
    try {
      if (lastRenderedWidth && bitmap.width * MIN_STRETCH > lastRenderedWidth) return;
      if (bitmap.width * bitmap.height > MAX_GPU_PAGE_PIXELS) return;
      if (isColorBitmap(bitmap)) {
        // MangaJaNai is for black and white; color pages use the fast model.
        await prefetchMangaPage(url, headers, key);
        return;
      }
      height = chapterBestHeight(bitmap.height);
    } finally {
      bitmap.close();
    }
    if (!(await bestModelInstalled(height))) {
      if (!autoDownload) return;
      await downloadBestModel(height);
    }
    if (!isBestUpscalerActive()) return;
    await upscaleBestPage(key, blob, height);
  } catch {
    // Prefetch is best effort; the reader still runs the page pass on arrival.
  }
}

/** Warms the page cache for a page the reader has not reached yet. */
export async function prefetchMangaPage(
  url: string,
  headers?: Record<string, string>,
  key = url,
): Promise<void> {
  if (!url) return;
  if (!isMangaUpscalerActive()) return;
  try {
    if (await cachedMangaPage(key)) return;
    const blob = await readBlob(url, headers);
    if (!blob) return;
    const bitmap = await createImageBitmap(blob);
    try {
      if (!isMangaUpscalerActive()) {
        bitmap.close();
        return;
      }
      await upscaleMangaPage(key, bitmap);
    } catch {
      bitmap.close();
    }
  } catch {
    // Prefetch is best effort; the reader still upscales on arrival.
  }
}
