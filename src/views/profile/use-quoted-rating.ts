import { useEffect, useState } from "react";
import { activeProfileId } from "@/lib/active-profile-id";
import type { RatingQuote } from "@/lib/ratings/quote";
import type { PublicRating } from "@/lib/ratings/types";
import { fetchUserRatings } from "@/lib/social/ratings-api";
import { captureSessionScope, currentAuthor, subscribeAuthor } from "@/lib/theme-auth";

export const RATINGS_CACHE_TTL_MS = 60000;

export type RatingsLoad = {
  items: PublicRating[];
  /** False when the walk stopped early, so more pages may exist behind the cursor it left. */
  complete: boolean;
};

type PageResult = { failed?: unknown; invalidated?: boolean };

type History = {
  items: PublicRating[];
  keys: Set<string>;
  cursor?: string;
  exhausted: boolean;
  /** Last time a page arrived; incomplete and complete histories share the same expiry. */
  at: number;
  scopeKey: string;
  isSessionCurrent: () => boolean;
  page: Promise<PageResult> | null;
};

const histories = new Map<string, History>();

const ratingKey = (rating: PublicRating) => `${rating.mediaType}|${rating.itemKey}`;

function currentScopeKey(): string {
  const author = currentAuthor();
  return `${activeProfileId()}|${author?.id ?? "guest"}|${author?.handle?.toLowerCase() ?? ""}`;
}

let observedScopeKey = currentScopeKey();
subscribeAuthor(() => {
  const next = currentScopeKey();
  if (next === observedScopeKey) return;
  histories.clear();
  observedScopeKey = next;
});

function historyCacheKey(handle: string, scopeKey: string): string {
  return `${scopeKey}|${handle.toLowerCase()}`;
}

function discardHistory(handle: string, history: History): void {
  const key = historyCacheKey(handle, history.scopeKey);
  if (histories.get(key) === history) histories.delete(key);
  history.items = [];
  history.keys.clear();
  history.cursor = undefined;
  history.exhausted = true;
  history.at = Date.now();
}

function historyFor(handle: string): History {
  const isSessionCurrent = captureSessionScope();
  const scopeKey = currentScopeKey();
  const cacheKey = historyCacheKey(handle, scopeKey);
  let hit = histories.get(cacheKey);
  if (hit && (!hit.isSessionCurrent() || currentScopeKey() !== hit.scopeKey)) {
    discardHistory(handle, hit);
    hit = undefined;
  }
  // Share an active walk rather than spawning a duplicate request just because it is slow.
  if (hit?.page) return hit;
  // Expire partial histories too: a quote may stop at its matching page while later pages exist.
  if (hit && Date.now() - hit.at < RATINGS_CACHE_TTL_MS) return hit;
  if (hit) histories.delete(cacheKey);
  const fresh: History = {
    items: [],
    keys: new Set(),
    exhausted: false,
    at: Date.now(),
    scopeKey,
    isSessionCurrent,
    page: null,
  };
  histories.set(cacheKey, fresh);
  return fresh;
}

/** The server refuses to show hidden ratings, which is a fact rather than a transient failure. */
function isRefusal(error: unknown): boolean {
  const status = (error as { status?: number } | null | undefined)?.status;
  return status === 403 || status === 404;
}

/**
 * Fetches one page for the cursor the history is sitting on. Concurrent lookups share the
 * in-flight request, and a failure leaves the cursor untouched so the next attempt resumes there.
 */
function nextPage(handle: string, history: History): Promise<PageResult> {
  if (history.page) return history.page;
  history.page = (async () => {
    if (!history.isSessionCurrent() || currentScopeKey() !== history.scopeKey) {
      discardHistory(handle, history);
      return { invalidated: true };
    }
    try {
      const rated = await fetchUserRatings(handle, { cursor: history.cursor });
      if (!history.isSessionCurrent() || currentScopeKey() !== history.scopeKey) {
        discardHistory(handle, history);
        return { invalidated: true };
      }
      for (const item of rated.items) {
        const key = ratingKey(item);
        if (history.keys.has(key)) continue;
        history.keys.add(key);
        history.items.push(item);
      }
      history.at = Date.now();
      // A cursor that repeats would make the walk fetch the same page forever.
      if (!rated.nextCursor || rated.nextCursor === history.cursor) history.exhausted = true;
      else history.cursor = rated.nextCursor;
      return {};
    } catch (failed) {
      if (!history.isSessionCurrent() || currentScopeKey() !== history.scopeKey) {
        discardHistory(handle, history);
        return { invalidated: true };
      }
      if (isRefusal(failed)) discardHistory(handle, history);
      return { failed };
    } finally {
      history.page = null;
    }
  })();
  return history.page;
}

type WalkResult = { complete: boolean; unavailable: boolean };

/**
 * Pages through a history until it runs out, until `match` is satisfied (a quoted card only
 * needs the one rating it points at), or until a request fails. Everything fetched on the way
 * stays in the history either way.
 */
async function walk(
  handle: string,
  history: History,
  match?: (rating: PublicRating) => boolean,
): Promise<WalkResult> {
  while (!history.exhausted) {
    if (match && history.items.some(match)) return { complete: true, unavailable: false };
    const page = await nextPage(handle, history);
    if (page.invalidated) return { complete: true, unavailable: true };
    if (page.failed !== undefined) {
      return { complete: false, unavailable: isRefusal(page.failed) };
    }
  }
  return { complete: true, unavailable: false };
}

/**
 * The ratings behind the "#" picker: every page the API will hand over, or whatever was
 * fetched before a failure, so one bad page no longer empties the list.
 */
export function loadRatings(handle: string): Promise<RatingsLoad> {
  const history = historyFor(handle);
  return walk(handle, history).then((result) => ({
    items: history.items,
    // A refused list is finished: there is nothing further to ask for.
    complete: result.complete || result.unavailable,
  }));
}

export type QuotedRatingLookup = {
  state: "loading" | "ready" | "missing" | "incomplete";
  rating?: PublicRating;
  /** Available when a walk stopped early: resuming it picks up from where it failed. */
  retry?: () => void;
};

async function resolve(
  handle: string,
  itemKey: string,
  mediaType: RatingQuote["mediaType"],
): Promise<QuotedRatingLookup> {
  const history = historyFor(handle);
  const match = (rating: PublicRating) =>
    rating.itemKey === itemKey && rating.mediaType === mediaType;
  const hit = history.items.find(match);
  if (hit) return { state: "ready", rating: hit };
  const result = await walk(handle, history, match);
  const found = history.items.find(match);
  if (found) return { state: "ready", rating: found };
  // Exhausted or refused: the rating really is not there. An unfinished walk cannot say.
  if (result.complete || result.unavailable) return { state: "missing" };
  return { state: "incomplete" };
}

export function useQuotedRating(quote: RatingQuote | null): QuotedRatingLookup {
  const handle = quote?.authorHandle ?? "";
  const itemKey = quote?.itemKey ?? "";
  const mediaType = quote?.mediaType;
  const [lookup, setLookup] = useState<QuotedRatingLookup>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [sessionRevision, setSessionRevision] = useState(0);

  useEffect(
    () =>
      subscribeAuthor(() => {
        setLookup({ state: "loading" });
        setSessionRevision((revision) => revision + 1);
      }),
    [],
  );

  useEffect(() => {
    if (!handle || !itemKey || !mediaType || typeof window === "undefined") return;
    const timer = window.setTimeout(() => setAttempt((n) => n + 1), RATINGS_CACHE_TTL_MS);
    return () => window.clearTimeout(timer);
  }, [handle, itemKey, mediaType, attempt, sessionRevision]);

  useEffect(() => {
    if (!handle || !itemKey || !mediaType) {
      setLookup({ state: "missing" });
      return;
    }
    let live = true;
    setLookup({ state: "loading" });
    void resolve(handle, itemKey, mediaType).then((next) => {
      if (live) setLookup(next);
    });
    return () => {
      live = false;
    };
  }, [handle, itemKey, mediaType, attempt, sessionRevision]);

  return lookup.state === "incomplete"
    ? { ...lookup, retry: () => setAttempt((n) => n + 1) }
    : lookup;
}
