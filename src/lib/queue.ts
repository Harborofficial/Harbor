import { useSyncExternalStore } from "react";
import type { Meta } from "@/lib/cinemeta";
import type { PlayEpisode } from "@/lib/view";
import { persistCritical, setItemWithRecovery } from "@/lib/storage-recovery";
import {
  activeProfileId,
  primaryProfileId,
  isNuvioProviderActive,
  nuvioWatchedScope,
} from "@/lib/active-profile-id";

export type QueueItem = {
  id: string;
  meta: Meta;
  episode?: PlayEpisode;
  addedAt: number;
};

const KEY = "harbor.queue.v1";
const SLEEP_KEY = "harbor.queue.sleepAtEnd.v1";
const RESUME_KEY = "harbor.queue.resumeItem.v1";

const PREFIX = "harbor.queue.v2.";
const MIGRATION_KEY = "harbor.queue.migration.v2";
type QueueState = { items: QueueItem[]; resumeItemId: string | null; sleepAtEnd: boolean };
let scope: string | null | undefined;
let items: QueueItem[] = [];
let resumeItemId: string | null = null;
let sleepAtEnd = false;
let playingKey: string | null = null;
const cache = new Map<string, QueueState>();
const listeners = new Set<() => void>();

function profileKey(id: string): string {
  return `${PREFIX}profile.${encodeURIComponent(id)}`;
}

function storeKey(): string | null {
  if (!isNuvioProviderActive()) return profileKey(activeProfileId());
  const owner = nuvioWatchedScope();
  return owner === "nuvio.v2.unowned" ? null : PREFIX + owner;
}

function migrateLegacy(): void {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return;
    const legacy = JSON.parse(raw);
    if (!Array.isArray(legacy)) return;
    let target = localStorage.getItem(MIGRATION_KEY);
    if (!target) {
      if (isNuvioProviderActive()) {
        const owner = nuvioWatchedScope(1);
        if (owner === "nuvio.v2.unowned") return;
        target = PREFIX + owner;
      } else {
        const primary = primaryProfileId();
        if (!primary) return;
        target = profileKey(primary);
      }
      // Claim one owner before copying, so a failed write cannot migrate to another profile.
      if (!setItemWithRecovery(MIGRATION_KEY, target)) return;
    }
    if (localStorage.getItem(target) !== null) return;
    setItemWithRecovery(
      target,
      JSON.stringify({
        items: legacy,
        resumeItemId: localStorage.getItem(RESUME_KEY),
        sleepAtEnd: localStorage.getItem(SLEEP_KEY) === "1",
      }),
    );
  } catch {
    // Keep legacy keys intact for retry/recovery; never expose them in another scope.
  }
}

function syncScope(): string | null {
  const next = storeKey();
  if (scope === next) return next;
  migrateLegacy();
  scope = next;
  playingKey = null;
  let state = next ? cache.get(next) : undefined;
  if (!state && next) {
    try {
      const parsed = JSON.parse(localStorage.getItem(next) ?? "null");
      if (parsed && Array.isArray(parsed.items)) {
        state = {
          items: parsed.items,
          resumeItemId: typeof parsed.resumeItemId === "string" ? parsed.resumeItemId : null,
          sleepAtEnd: parsed.sleepAtEnd === true,
        };
      }
    } catch {
      /* Invalid or unavailable storage starts with an empty scoped queue. */
    }
  }
  items = state?.items ?? [];
  resumeItemId = state?.resumeItemId ?? null;
  sleepAtEnd = state?.sleepAtEnd ?? false;
  return next;
}

function persist(): void {
  if (!scope) return;
  const state = { items, resumeItemId, sleepAtEnd };
  cache.set(scope, state);
  persistCritical(scope, JSON.stringify(state));
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
  syncScope();
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
  if (!syncScope()) return;
  const k = keyOf(meta, episode);
  if (items.some((i) => keyOf(i.meta, i.episode) === k)) return;
  items = [...items, { id: rid(), meta, episode, addedAt: Date.now() }];
  persist();
}

export function queueRemove(id: string): void {
  if (!syncScope()) return;
  if (!items.some((item) => item.id === id)) return;
  replaceQueueItems(items.filter((item) => item.id !== id));
}

export function queueToggle(meta: Meta, episode?: PlayEpisode): void {
  if (!syncScope()) return;
  const k = keyOf(meta, episode);
  const existing = items.find((i) => keyOf(i.meta, i.episode) === k);
  if (existing) queueRemove(existing.id);
  else queueAdd(meta, episode);
}

export function queueClear(): void {
  if (!syncScope()) return;
  if (items.length === 0 && !resumeItemId) return;
  resumeItemId = null;
  items = [];
  persist();
}

export function queueReorder(orderedIds: string[]): void {
  if (!syncScope()) return;
  const pos = new Map(orderedIds.map((id, i) => [id, i] as const));
  items = [...items].sort((a, b) => (pos.get(a.id) ?? 999) - (pos.get(b.id) ?? 999));
  persist();
}

export function queueIndexOf(meta: Meta, episode?: PlayEpisode): number {
  syncScope();
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
    () => {
      syncScope();
      return items;
    },
    () => {
      syncScope();
      return items;
    },
  );
}

export function useIsQueued(meta: Meta, episode?: PlayEpisode): boolean {
  const q = useQueue();
  const k = keyOf(meta, episode);
  return q.some((i) => keyOf(i.meta, i.episode) === k);
}

export function getSleepAtEnd(): boolean {
  syncScope();
  return sleepAtEnd;
}

export function setSleepAtEnd(on: boolean): void {
  if (!syncScope()) return;
  sleepAtEnd = on;
  persist();
}

export function useSleepAtEnd(): boolean {
  return useSyncExternalStore(subscribe, getSleepAtEnd, getSleepAtEnd);
}

export function setQueuePlaying(meta: Meta | null, episode?: PlayEpisode): void {
  if (!syncScope()) return;
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
    () => {
      syncScope();
      return items.find((item) => item.id === resumeItemId) ?? null;
    },
    () => null,
  );
}

if (typeof window !== "undefined") {
  const onScopeChange = () => {
    syncScope();
    listeners.forEach((listener) => listener());
  };
  for (const event of [
    "harbor:active-profile-changed",
    "harbor:profiles-updated",
    "harbor:account-provider-changed",
    "harbor:nuvio-profile-changed",
    "harbor:nuvio-state-changed",
  ])
    window.addEventListener(event, onScopeChange);
  window.addEventListener("storage", (event) => {
    if (!event.key || event.key.startsWith(PREFIX)) {
      if (event.key) cache.delete(event.key);
      else cache.clear();
      scope = undefined;
    }
    onScopeChange();
  });
}
