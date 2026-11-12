import { makeSafeTauriUnlisten } from "./tauri-unlisten";
import { previewWindow } from "./trickplay-policy";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { useSyncExternalStore } from "react";

export type TrickplayState = { active: boolean; bufferedOnly: boolean };
const IDLE: TrickplayState = { active: false, bufferedOnly: false };
let state: TrickplayState = IDLE;
const listeners = new Set<() => void>();

export function setTrickplayState(next: TrickplayState): void {
  if (state.active === next.active && state.bufferedOnly === next.bufferedOnly) return;
  state = next;
  for (const l of listeners) l();
}

export function useTrickplayState(): TrickplayState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
    () => IDLE,
  );
}

const thumbCache = new Map<number, string>();
const thumbReceivedAt = new Map<number, number>();
const THUMB_CACHE_MAX_BYTES = 24 * 1024 * 1024;
let thumbCacheBytes = 0;
const thumbListeners = new Set<(bucket: number) => void>();
let session: string | null = null;
let generation = 0;
let lifecycle: Promise<void> = Promise.resolve();
let unlisten: UnlistenFn | null = null;
let prefetchAllowed = false;
let duration = 0;
let lastHover: number | null = null;

export function subscribeThumbnails(listener: (bucket: number) => void): () => void {
  thumbListeners.add(listener);
  return () => {
    thumbListeners.delete(listener);
  };
}

export function useThumbnailSession(): number {
  return useSyncExternalStore(
    subscribeThumbnails,
    () => generation,
    () => 0,
  );
}

function notifyThumbnail(bucket: number): void {
  for (const listener of thumbListeners) listener(bucket);
}

export function thumbCacheGet(bucket: number): string | undefined {
  return thumbCache.get(bucket);
}

export function thumbCacheReceivedAt(bucket: number): number | undefined {
  return thumbReceivedAt.get(bucket);
}

export function thumbCacheSet(bucket: number, dataUri: string): void {
  if (dataUri.length > THUMB_CACHE_MAX_BYTES) return;
  thumbCacheBytes -= thumbCache.get(bucket)?.length ?? 0;
  thumbCache.delete(bucket);
  thumbCache.set(bucket, dataUri);
  thumbReceivedAt.set(bucket, performance.now());
  thumbCacheBytes += dataUri.length;
  while (thumbCache.size > 512 || thumbCacheBytes > THUMB_CACHE_MAX_BYTES) {
    const oldest = thumbCache.keys().next().value!;
    thumbCacheBytes -= thumbCache.get(oldest)!.length;
    thumbCache.delete(oldest);
    thumbReceivedAt.delete(oldest);
  }
  notifyThumbnail(bucket);
}

export function thumbCacheNearest(bucket: number, maxDistance: number): string | undefined {
  const exact = thumbCache.get(bucket);
  if (exact) return exact;
  let best: string | undefined;
  let bestDist = Infinity;
  for (const [b, uri] of thumbCache) {
    const d = Math.abs(b - bucket);
    if (d < bestDist) {
      best = uri;
      bestDist = d;
    }
  }
  return bestDist <= maxDistance ? best : undefined;
}

export function trickplaySetUrl(url: string, headers?: Record<string, string>): Promise<void> {
  const current = ++generation;
  session = null;
  prefetchAllowed = false;
  lastHover = null;
  thumbCache.clear();
  thumbReceivedAt.clear();
  thumbCacheBytes = 0;
  notifyThumbnail(-1);
  unlisten?.();
  unlisten = null;
  lifecycle = lifecycle
    .then(async () => {
      if (current !== generation) return;
      const stop = await listen<{ session: string; bucket: number; uri: string | null }>(
        "thumb-ready",
        ({ payload }) => {
          if (current !== generation || payload.session !== session) return;
          if (payload.uri) thumbCacheSet(payload.bucket, payload.uri);
          else notifyThumbnail(payload.bucket);
        },
      );
      if (current !== generation) {
        makeSafeTauriUnlisten(stop)();
        return;
      }
      unlisten = makeSafeTauriUnlisten(stop);
      const id = await invoke<string>("thumbs_set_url", { url, headers: headers ?? {} });
      if (current === generation) session = id;
    })
    .catch(() => {});
  return lifecycle;
}

export async function trickplaySpawnEager(): Promise<void> {
  const current = generation;
  await lifecycle;
  if (current !== generation || !session) return;
  try {
    await invoke("thumbs_spawn_eager");
  } catch {}
}

export async function trickplayGet(timeSec: number): Promise<string | null> {
  const current = generation;
  await lifecycle;
  if (current !== generation || !session) return null;
  try {
    const result = await invoke<string | null>("thumbs_get", { timeSec, session });
    if (current !== generation) return null;
    if (result) thumbCacheSet(Math.round(timeSec / 2), result);
    return result;
  } catch {
    return null;
  }
}

export async function trickplayWarm(
  position: number,
  durationSec: number,
  allowed: boolean,
): Promise<void> {
  prefetchAllowed = allowed;
  duration = durationSec;
  if (!session) return;
  const times = allowed ? previewWindow(Math.floor(position / 10) * 10, durationSec, 1, 10) : [];
  try {
    await invoke("thumbs_prefetch", { session, times, durationSec });
  } catch {}
}

export async function trickplayPrefetchHover(time: number): Promise<void> {
  const direction = lastHover !== null && time < lastHover ? -1 : 1;
  lastHover = time;
  if (!prefetchAllowed || !session) return;
  try {
    await invoke("thumbs_prefetch", { session, times: previewWindow(time, duration, direction) });
  } catch {}
}

export function trickplayStop(): Promise<void> {
  ++generation;
  session = null;
  prefetchAllowed = false;
  thumbCache.clear();
  thumbReceivedAt.clear();
  thumbCacheBytes = 0;
  notifyThumbnail(-1);
  unlisten?.();
  unlisten = null;
  lifecycle = lifecycle.then(async () => {
    try {
      await invoke("thumbs_stop");
    } catch {}
  });
  return lifecycle;
}
