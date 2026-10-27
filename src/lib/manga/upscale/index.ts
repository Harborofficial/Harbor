import { BEST_PAGE_CACHE, MANGA_UPSCALE_MODEL, MODEL_CACHE, PAGE_CACHE } from "./model";
import { MangaWorkerClient } from "./worker-client";
import { notifyMangaPageCached } from "./events";

const worker = new MangaWorkerClient("fast");
const inFlight = new Map<string, Promise<Blob>>();
let ready: Promise<void> | null = null;

function storage(): CacheStorage | null {
  try {
    return typeof caches === "undefined" ? null : caches;
  } catch {
    return null;
  }
}

function resetWorker() {
  worker.reset();
  inFlight.clear();
  ready = null;
}

let unloadTimer: number | null = null;
let active = false;

function cancelUnload() {
  if (unloadTimer === null) return;
  window.clearTimeout(unloadTimer);
  unloadTimer = null;
}

/** Cancels a pending idle unload while the reader is open. */
export function keepMangaUpscalerLoaded(): void {
  active = true;
  cancelUnload();
}

/** Frees the worker and its GPU model once the reader has been closed for a while.
 *  An in-flight page keeps it alive until that page finishes. */
export function scheduleMangaUpscalerUnload(delayMs = 7000): void {
  active = false;
  cancelUnload();
  unloadTimer = window.setTimeout(() => {
    unloadTimer = null;
    if (inFlight.size > 0) {
      scheduleMangaUpscalerUnload(delayMs);
      return;
    }
    resetWorker();
  }, delayMs);
}

export function isMangaUpscalerActive(): boolean {
  return active;
}

function sessionReady(): Promise<void> {
  if (ready) return ready;
  ready = (async () => {
    const cache = storage();
    if (!cache) throw new Error("Model storage is unavailable");
    const hit = await (await cache.open(MODEL_CACHE)).match(MANGA_UPSCALE_MODEL.url);
    if (!hit) throw new Error("The manga upscale model is not installed");
    const model = await hit.arrayBuffer();
    await worker.ensure(model, MANGA_UPSCALE_MODEL.url);
  })().catch((error) => {
    ready = null;
    throw error;
  });
  return ready;
}

/** Boots the worker while a page downloads so the first page does not pay for it. */
export function warmMangaUpscaler(): void {
  if (!storage()) return;
  void sessionReady().catch(() => {});
}

export type MangaUpscaleStatus = {
  installed: boolean;
  pages: number;
  bestPages: number;
  provider: "webgpu" | "wasm" | null;
};

export function mangaUpscaleProvider(): "webgpu" | "wasm" | null {
  return worker.activeProvider;
}

function pageKey(key: string): string {
  // Cache keys must be absolute http(s) URLs, so pages are namespaced under a
  // fixed host instead of the page URL itself.
  return `https://harbor.local/manga-upscale/${MANGA_UPSCALE_MODEL.id}?page=${encodeURIComponent(key)}`;
}

export async function cachedMangaPage(key: string): Promise<Blob | null> {
  const cache = storage();
  if (!cache) return null;
  try {
    const hit = await (await cache.open(PAGE_CACHE)).match(pageKey(key));
    return hit ? await hit.blob() : null;
  } catch {
    return null;
  }
}

export async function mangaUpscaleStatus(): Promise<MangaUpscaleStatus> {
  const cache = storage();
  const provider = worker.activeProvider;
  if (!cache) return { installed: false, pages: 0, bestPages: 0, provider };
  try {
    const model = await (await cache.open(MODEL_CACHE)).match(MANGA_UPSCALE_MODEL.url);
    const pages = (await (await cache.open(PAGE_CACHE)).keys()).length;
    const bestPages = (await (await cache.open(BEST_PAGE_CACHE)).keys()).length;
    return { installed: !!model, pages, bestPages, provider };
  } catch {
    return { installed: false, pages: 0, bestPages: 0, provider };
  }
}

function hex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function downloadMangaModel(): Promise<void> {
  const cache = storage();
  if (!cache) throw new Error("Model storage is unavailable");
  const response = await fetch(MANGA_UPSCALE_MODEL.url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Model download failed (${response.status})`);
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength !== MANGA_UPSCALE_MODEL.bytes)
    throw new Error("Model download is incomplete");
  if (hex(await crypto.subtle.digest("SHA-256", bytes)) !== MANGA_UPSCALE_MODEL.sha256)
    throw new Error("Model checksum does not match");
  await (
    await cache.open(MODEL_CACHE)
  ).put(
    MANGA_UPSCALE_MODEL.url,
    new Response(bytes, { headers: { "content-type": "application/octet-stream" } }),
  );
}

export async function removeMangaModel(): Promise<void> {
  resetWorker();
  await storage()?.delete(MODEL_CACHE);
}

export async function clearMangaPages(): Promise<void> {
  inFlight.clear();
  await storage()?.delete(PAGE_CACHE);
  await storage()?.delete(BEST_PAGE_CACHE);
}

/**
 * Returns a 2x PNG for a page. The original bitmap is consumed. Cached results
 * are keyed by a stable page identity, so revisiting a URL with a fresh token
 * still hits the cache.
 */
export async function upscaleMangaPage(key: string, bitmap: ImageBitmap): Promise<Blob> {
  const cacheKey = pageKey(key);
  const running = inFlight.get(cacheKey);
  if (running) {
    bitmap.close();
    return running;
  }
  const task = (async () => {
    const cache = storage();
    const hit = cache ? await (await cache.open(PAGE_CACHE)).match(cacheKey) : undefined;
    if (hit) {
      bitmap.close();
      return await hit.blob();
    }
    await sessionReady();
    const blob = await worker.upscale(bitmap);
    if (cache)
      await (
        await cache.open(PAGE_CACHE)
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

/** WebGPU is the only path fast enough to keep up with reading; wasm is a fallback. */
export async function mangaUpscaleSupport(): Promise<{ worker: boolean; webgpu: boolean }> {
  const workerSupport =
    typeof Worker !== "undefined" &&
    typeof OffscreenCanvas !== "undefined" &&
    typeof createImageBitmap === "function";
  let webgpu = false;
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    webgpu = !!(gpu && (await gpu.requestAdapter()));
  } catch {
    webgpu = false;
  }
  return { worker: workerSupport, webgpu };
}
