import { useSyncExternalStore } from "react";
import type { SubtitlePreparationReason } from "./prepare";
import type { SubtitleLoadMetadata } from "./types";

/**
 * A subtitle a translating addon accepted but has not produced yet. Harbor keeps
 * re-checking the same URL and, once the finished file is served, adds it automatically.
 */
export type TranslationJob = {
  url: string;
  lang?: string;
  title?: string;
  metadata?: SubtitleLoadMetadata;
  startedAt: number;
};

/**
 * A translation a player engine is still waiting for, with the media revision the
 * request belongs to. Engines drop it when the viewer moves on or the media changes.
 */
export type PendingSubtitleTranslation = {
  url: string;
  lang?: string;
  title?: string;
  metadata?: SubtitleLoadMetadata;
  mediaRevision: number;
  /** Cleared once the request is cancelled or settles; retries stop when false. */
  active: boolean;
};

/** Give up on a translation that never arrives. */
export const TRANSLATION_JOB_MAX_MS = 10 * 60 * 1000;

/** How often a still-pending translation is re-checked. */
export const TRANSLATION_RETRY_MS = 30_000;

const PENDING_REASON: SubtitlePreparationReason = "translation-pending";

/** True for the error a translating addon reports while it is still producing the file. */
export function isTranslationPendingError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { reason?: unknown }).reason === PENDING_REASON
  );
}

let jobs: TranslationJob[] = [];
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Replace the tracked pending translations. Every mutation below goes through it. */
export function publishSubtitleTranslations(translations: TranslationJob[]): void {
  jobs = translations
    .filter((job) => Boolean(job.url))
    .map((job) => ({ ...job, startedAt: job.startedAt || Date.now() }));
  emit();
}

/** Begins tracking a pending translation. Idempotent per URL, keeping the first start time. */
export function registerTranslationJob(job: Omit<TranslationJob, "startedAt">): void {
  if (!job.url || jobs.some((existing) => existing.url === job.url)) return;
  publishSubtitleTranslations([...jobs, { ...job, startedAt: Date.now() }]);
}

export function completeTranslationJob(url: string): void {
  if (!jobs.some((existing) => existing.url === url)) return;
  publishSubtitleTranslations(jobs.filter((existing) => existing.url !== url));
}

/** Drop every pending job (e.g. the media changed and they no longer apply). */
export function clearTranslationJobs(): void {
  if (jobs.length === 0) return;
  publishSubtitleTranslations([]);
}

export function useTranslationJobs(): TranslationJob[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => jobs,
    () => jobs,
  );
}

/** True while a translation for this exact URL is still pending. */
export function useTranslationJob(url: string): boolean {
  const list = useTranslationJobs();
  return list.some((job) => job.url === url);
}

/** How a translation URL is progressing: re-checked, given up on, or no longer tracked. */
export type SubtitleTranslationStatus = "pending" | "failed";

const statuses = new Map<string, SubtitleTranslationStatus>();

export function subtitleTranslationStatus(url: string): SubtitleTranslationStatus | null {
  return statuses.get(url) ?? null;
}

export type SubtitleTranslationQueue = {
  /**
   * Attempts the translation now and keeps re-attempting it every
   * TRANSLATION_RETRY_MS while it answers "pending", until it succeeds or
   * TRANSLATION_JOB_MAX_MS passes. The returned promise reports the attempt this
   * call started; later attempts are reported through subtitleTranslationStatus.
   * Runs are serialized per URL: while one attempt is unresolved no other starts.
   */
  run(url: string, isActive: () => boolean, attempt: () => Promise<boolean>): Promise<boolean>;
  /** Cancel every in-flight and scheduled attempt. */
  clear(): void;
};

type QueueEntry = {
  url: string;
  isActive: () => boolean;
  attempt: () => Promise<boolean>;
  startedAt: number;
  timer: ReturnType<typeof setTimeout> | null;
  cancelled: boolean;
  resolve: ((value: boolean) => void) | null;
};

export function createSubtitleTranslationQueue(): SubtitleTranslationQueue {
  const entries = new Map<string, QueueEntry>();

  const settle = (entry: QueueEntry, added: boolean): void => {
    const resolve = entry.resolve;
    entry.resolve = null;
    resolve?.(added);
  };

  const stop = (entry: QueueEntry, status: SubtitleTranslationStatus | null): void => {
    if (entry.timer != null) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }
    if (entries.get(entry.url) === entry) entries.delete(entry.url);
    if (status) statuses.set(entry.url, status);
    else statuses.delete(entry.url);
    completeTranslationJob(entry.url);
  };

  const runAttempt = async (entry: QueueEntry): Promise<void> => {
    let outcome: "added" | "failed" | "pending" = "failed";
    try {
      outcome = (await entry.attempt()) ? "added" : "failed";
    } catch (error) {
      outcome = isTranslationPendingError(error) ? "pending" : "failed";
    }
    if (entry.cancelled) {
      settle(entry, false);
      return;
    }
    if (outcome === "pending") {
      statuses.set(entry.url, "pending");
      settle(entry, false);
      scheduleRetry(entry);
      return;
    }
    stop(entry, outcome === "added" ? null : "failed");
    settle(entry, outcome === "added");
  };

  const scheduleRetry = (entry: QueueEntry): void => {
    entry.timer = setTimeout(() => {
      entry.timer = null;
      if (entry.cancelled) return;
      if (!entry.isActive()) {
        stop(entry, null);
        return;
      }
      if (Date.now() - entry.startedAt >= TRANSLATION_JOB_MAX_MS) {
        stop(entry, "failed");
        return;
      }
      void runAttempt(entry);
    }, TRANSLATION_RETRY_MS);
  };

  return {
    run(url, isActive, attempt) {
      // One request per URL: a second caller joins the existing job instead of
      // racing a duplicate download.
      if (entries.has(url)) return Promise.resolve(false);
      const entry: QueueEntry = {
        url,
        isActive,
        attempt,
        startedAt: Date.now(),
        timer: null,
        cancelled: false,
        resolve: null,
      };
      entries.set(url, entry);
      return new Promise<boolean>((resolve) => {
        entry.resolve = resolve;
        void runAttempt(entry);
      });
    },
    clear() {
      const current = [...entries.values()];
      entries.clear();
      for (const entry of current) {
        entry.cancelled = true;
        if (entry.timer != null) {
          clearTimeout(entry.timer);
          entry.timer = null;
        }
        statuses.delete(entry.url);
        settle(entry, false);
      }
    },
  };
}
