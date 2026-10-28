import { useSyncExternalStore } from "react";
import type { Meta } from "@/lib/cinemeta";
import type { PlayEpisode } from "@/lib/view";
import { persistCritical } from "@/lib/storage-recovery";

export type QueueItem = {
  id: string;
  meta: Meta;
  episode?: PlayEpisode;
  addedAt: number;
};

const KEY = "harbor.queue.v1";
const SLEEP_KEY = "harbor.queue.sleepAtEnd.v1";
const RESUME_KEY = "harbor.queue.resumeItem.v1";

let items: QueueItem[] = load();
let resumeItemId: string | null = loadResumeItemId();

function loadResumeItemId(): string | null {
  try {
    return localStorage.getItem(RESUME_KEY);
  } catch {
    return null;
  }
}

const listeners = new Set<() => void>();

function load(): QueueItem[] {
  try {
    const raw = localStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? (arr as QueueItem[]) : [];
  } catch {
    return [];
  }
}

function persist(): void {
  persistCritical(KEY, JSON.stringify(items));
  persistCritical(RESUME_KEY, resumeItemId ?? "");
  listeners.forEach((l) => l());
}

function replaceQueueItems(next: QueueItem[]): void {
  if (resumeItemId && !next.some((item) => item.id === resumeItemId)) {
    const previousIndex = items.findIndex((item) => item.id === resumeItemId);
    const remainingIds = new Set(next.map((item) => item.id));
    const successor =
      previousIndex >= 0
        ? items.slice(previousIndex + 1).find((item) => remainingIds.has(item.id))
        : undefined;

    resumeItemId = successor?.id ?? next[0]?.id ?? null;
  }

  items = next;
  persist();
}

export function getQueueStartItem(resume = false): QueueItem | null {
  if (resume && resumeItemId) {
    const saved = items.find((item) => item.id === resumeItemId);
    if (saved) return saved;
  }

  return items[0] ?? null;
}

function rid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function keyOf(meta: Meta, episode?: PlayEpisode): string {
  return `${meta.id}${episode ? `:${episode.season}:${episode.episode}` : ""}`;
}

export function queueAdd(meta: Meta, episode?: PlayEpisode): void {
  const k = keyOf(meta, episode);
  if (items.some((i) => keyOf(i.meta, i.episode) === k)) return;
  items = [...items, { id: rid(), meta, episode, addedAt: Date.now() }];
  persist();
}

export function queueRemove(id: string): void {
  if (!items.some((item) => item.id === id)) return;
  replaceQueueItems(items.filter((item) => item.id !== id));
}

export function queueToggle(meta: Meta, episode?: PlayEpisode): void {
  const k = keyOf(meta, episode);
  const existing = items.find((i) => keyOf(i.meta, i.episode) === k);
  if (existing) queueRemove(existing.id);
  else queueAdd(meta, episode);
}

export function queueClear(): void {
  if (items.length === 0 && !resumeItemId) return;
  resumeItemId = null;
  items = [];
  persist();
}

export function queueReorder(orderedIds: string[]): void {
  const pos = new Map(orderedIds.map((id, i) => [id, i] as const));
  items = [...items].sort((a, b) => (pos.get(a.id) ?? 999) - (pos.get(b.id) ?? 999));
  persist();
}

export function queueIndexOf(meta: Meta, episode?: PlayEpisode): number {
  const k = keyOf(meta, episode);
  return items.findIndex((i) => keyOf(i.meta, i.episode) === k);
}

export function queueItemAfter(meta: Meta, episode?: PlayEpisode): QueueItem | null {
  const idx = queueIndexOf(meta, episode);
  if (idx < 0) return null;
  return items[idx + 1] ?? null;
}

export function queueItemBefore(meta: Meta, episode?: PlayEpisode): QueueItem | null {
  const idx = queueIndexOf(meta, episode);
  if (idx <= 0) return null;
  return items[idx - 1] ?? null;
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useQueue(): QueueItem[] {
  return useSyncExternalStore(
    subscribe,
    () => items,
    () => items,
  );
}

export function useIsQueued(meta: Meta, episode?: PlayEpisode): boolean {
  const q = useQueue();
  const k = keyOf(meta, episode);
  return q.some((i) => keyOf(i.meta, i.episode) === k);
}

export function getSleepAtEnd(): boolean {
  try {
    return localStorage.getItem(SLEEP_KEY) === "1";
  } catch {
    return false;
  }
}

export function setSleepAtEnd(on: boolean): void {
  try {
    if (on) localStorage.setItem(SLEEP_KEY, "1");
    else localStorage.removeItem(SLEEP_KEY);
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

export function useSleepAtEnd(): boolean {
  return useSyncExternalStore(subscribe, getSleepAtEnd, getSleepAtEnd);
}

let playingKey: string | null = null;

export function setQueuePlaying(meta: Meta | null, episode?: PlayEpisode): void {
  const next = meta ? keyOf(meta, episode) : null;
  if (next === playingKey) return;
  playingKey = next;

  const current = next ? items.find((item) => keyOf(item.meta, item.episode) === next) : undefined;

  if (current && resumeItemId !== current.id) {
    resumeItemId = current.id;
    persist();
  }
}

export function useQueueResumeItem(): QueueItem | null {
  return useSyncExternalStore(
    subscribe,
    () => items.find((item) => item.id === resumeItemId) ?? null,
    () => null,
  );
}
