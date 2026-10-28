import { getRating, setRatingLocal, removeRatingLocal } from "./store";
import { upsertRating, deleteRatingRemote } from "@/lib/social/ratings-api";
import type { MyRating, RatingTarget } from "./types";

/** Longest review a rating may carry. Shared so every review surface agrees. */
export const REVIEW_MAX = 4000;

// Requests may finish out of order (including from different rating surfaces). Only the
// latest operation for an item may update or restore the shared optimistic rating cache.
const ratingWriteVersions = new Map<string, number>();
function nextRatingWrite(itemKey: string): number {
  const version = (ratingWriteVersions.get(itemKey) ?? 0) + 1;
  ratingWriteVersions.set(itemKey, version);
  return version;
}
function isLatestRatingWrite(itemKey: string, version: number): boolean {
  return ratingWriteVersions.get(itemKey) === version;
}

function statusOf(e: unknown): number | undefined {
  return (e as { status?: number })?.status;
}

export async function rate(
  target: RatingTarget,
  score: number,
  extra?: { review?: string; spoiler?: boolean },
): Promise<void> {
  const version = nextRatingWrite(target.itemKey);
  const prev = getRating(target.itemKey);
  const review = extra?.review?.trim() || undefined;
  const spoiler = extra?.spoiler || undefined;
  const optimistic: MyRating = {
    itemKey: target.itemKey,
    mediaType: target.mediaType,
    score,
    review,
    spoiler,
    title: target.title,
    poster: target.poster,
    updatedAt: Date.now(),
  };
  setRatingLocal(optimistic);
  try {
    const saved = await upsertRating({ ...target, score, review, spoiler });
    if (isLatestRatingWrite(target.itemKey, version)) setRatingLocal(saved);
  } catch (e) {
    const status = statusOf(e);
    if (
      isLatestRatingWrite(target.itemKey, version) &&
      status &&
      status >= 400 &&
      status < 500 &&
      status !== 429
    ) {
      if (prev) setRatingLocal(prev);
      else removeRatingLocal(target.itemKey);
    }
    throw e;
  }
}

export async function unrate(itemKey: string): Promise<void> {
  const version = nextRatingWrite(itemKey);
  const prev = getRating(itemKey);
  removeRatingLocal(itemKey);
  try {
    await deleteRatingRemote(itemKey);
  } catch (e) {
    if (prev && isLatestRatingWrite(itemKey, version)) setRatingLocal(prev);
    throw e;
  }
}
