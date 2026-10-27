import {
  BEST_MODEL_BYTES,
  BEST_HEIGHTS,
  BEST_MODEL_CACHE,
  BEST_PAGE_CACHE,
  bestModelUrl,
  nearestBestHeight,
} from "./model";
import { MangaWorkerClient } from "./worker-client";
import { notifyMangaPageCached } from "./events";

const worker = new MangaWorkerClient("best");
const inFlight = new Map<string, Promise<Blob>>();
const downloads = new Map<number, Promise<void>>();
let lastPageHeight = 0;
let chapterHeight: number | null = null;
let unloadTimer: number | null = null;
let active = false;

/** Lets the settings suggest a model for the last B&W page the reader saw. */
export function noteMangaPageHeight(height: number) {
  if (height > 0) lastPageHeight = height;
}

/** A chapter keeps one model: pages, panels and scanlator crops vary, but the
 * halftone frequency should not change from page to page. */
export function chapterBestHeight(pageHeight: number): number {
  if (chapterHeight === null) chapterHeight = nearestBestHeight(pageHeight);
  return chapterHeight;
}

export function resetBestChapterHeight() {
  chapterHeight = null;
}

export function preferredBestHeight(): number {
  return chapterHeight ?? nearestBestHeight(lastPageHeight || 1600);
}

/** Cancels a pending idle unload while the reader is open. */
export function keepBestUpscalerLoaded(): void {
  active = true;
  if (unloadTimer !== null) {
    window.clearTimeout(unloadTimer);
    unloadTimer = null;
  }
}

/** Frees the heavy model after the reader has been closed for a while.
 *  An in-flight page keeps it alive until that page finishes. */
export function scheduleBestUpscalerUnload(delayMs = 7000): void {
  active = false;
  if (unloadTimer !== null) {
    window.clearTimeout(unloadTimer);
    unloadTimer = null;
  }
  unloadTimer = window.setTimeout(() => {
    unloadTimer = null;
    if (inFlight.size > 0) {
      scheduleBestUpscalerUnload(delayMs);
      return;
    }
    worker.reset();
  }, delayMs);
}

export function isBestUpscalerActive(): boolean {
  return active;
}

function storage(): CacheStorage | null {
  try {
    return typeof caches === "undefined" ? null : caches;
  } catch {
    return null;
  }
}

function bestPageKey(key: string): string {
  return `https://harbor.local/manga-upscale/best?page=${encodeURIComponent(key)}`;
}

export function bestPageKeyFor(key: string): string {
  return bestPageKey(key);
}

function heightOf(url: string): number | null {
  const match = /2x_MangaJaNai_(\d+)p_/.exec(url);
  return match ? Number(match[1]) : null;
}

export async function cachedBestPage(key: string): Promise<Blob | null> {
  const cache = storage();
  if (!cache) return null;
  try {
    const hit = await (await cache.open(BEST_PAGE_CACHE)).match(bestPageKey(key));
    return hit ? await hit.blob() : null;
  } catch {
    return null;
  }
}

export type BestModelStatus = { heights: number[]; bytes: number };

export async function bestModelStatus(): Promise<BestModelStatus> {
  const cache = storage();
  if (!cache) return { heights: [], bytes: 0 };
  try {
    const keys = await (await cache.open(BEST_MODEL_CACHE)).keys();
    const heights = [...new Set(keys.map((key) => heightOf(key.url)).filter((h) => h != null))];
    heights.sort((a, b) => a - b);
    return { heights, bytes: heights.length * BEST_MODEL_BYTES };
  } catch {
    return { heights: [], bytes: 0 };
  }
}

export async function bestModelInstalled(height: number): Promise<boolean> {
  const cache = storage();
  if (!cache) return false;
  try {
    return !!(await (await cache.open(BEST_MODEL_CACHE)).match(bestModelUrl(height)));
  } catch {
    return false;
  }
}

/** Downloads one MangaJaNai height model (about 64 MB). */
export function downloadBestModel(height: number): Promise<void> {
  const existing = downloads.get(height);
  if (existing) return existing;
  const task = (async () => {
    const cache = storage();
    if (!cache) throw new Error("Model storage is unavailable");
    const url = bestModelUrl(height);
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`Model download failed (${response.status})`);
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength !== BEST_MODEL_BYTES) throw new Error("Model download is incomplete");
    await (
      await cache.open(BEST_MODEL_CACHE)
    ).put(url, new Response(bytes, { headers: { "content-type": "application/octet-stream" } }));
  })();
  const wrapped = task.finally(() => downloads.delete(height));
  downloads.set(height, wrapped);
  return wrapped;
}

async function ensureBest(height: number): Promise<void> {
  const url = bestModelUrl(height);
  if (worker.isLoaded(url)) return;
  const cache = storage();
  if (!cache) throw new Error("Model storage is unavailable");
  const hit = await (await cache.open(BEST_MODEL_CACHE)).match(url);
  if (!hit) throw new Error("The high-quality model is not downloaded");
  const model = await hit.arrayBuffer();
  await worker.ensure(model, url);
}

export function warmBestUpscaler(height: number): void {
  if (!storage()) return;
  void ensureBest(height).catch(() => {});
}

/**
 * Runs the heavy MangaJaNai pass for one page. The source is the original page
 * bytes, not the fast result, so the two models never stack.
 */
export async function upscaleBestPage(key: string, source: Blob, height: number): Promise<Blob> {
  const cacheKey = bestPageKey(key);
  const running = inFlight.get(cacheKey);
  if (running) return running;
  const task = (async () => {
    const cache = storage();
    const hit = cache ? await (await cache.open(BEST_PAGE_CACHE)).match(cacheKey) : undefined;
    if (hit) return await hit.blob();
    await ensureBest(height);
    const bitmap = await createImageBitmap(source);
    const blob = await worker.upscale(bitmap);
    if (cache)
      await (
        await cache.open(BEST_PAGE_CACHE)
      ).put(cacheKey, new Response(blob, { headers: { "content-type": "image/png" } }));
    notifyMangaPageCached(key);
    return blob;
  })();
  inFlight.set(cacheKey, task);
  try {
    return await task;
  } finally {
    inFlight.delete(cacheKey);
  }
}

export async function removeBestModels(): Promise<void> {
  worker.reset();
  inFlight.clear();
  await storage()?.delete(BEST_MODEL_CACHE);
}

export async function clearBestPages(): Promise<void> {
  inFlight.clear();
  await storage()?.delete(BEST_PAGE_CACHE);
}

export { BEST_HEIGHTS };
