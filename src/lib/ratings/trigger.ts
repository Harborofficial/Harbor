import type { PublicRating } from "./types";

export const RATING_PICKER_LIMIT = 6;

// A "#" the author types at the caret starts the rating trigger. A leading word character keeps
// "#" inside something like "C#" from opening the picker.
const TOKEN_RE = /(?:^|[^A-Za-z0-9_@#/])#([^#\s]{0,40})$/;

export type RatingToken = { start: number; query: string };

/** A person whose ratings the composer can quote from. */
export type RatingSource = { handle: string; label?: string; kind: "owner" | "me" | "friend" };

/** Removes the typed "#query" once a rating is picked, leaving the author's own words in place. */
export function withoutRatingToken(
  text: string,
  caret: number,
  start: number,
): { text: string; caret: number } {
  const at = Math.max(start, Math.min(caret, text.length));
  const end = text[at] === " " ? at + 1 : at;
  return { text: text.slice(0, start) + text.slice(end), caret: start };
}

export function ratingToken(text: string, caret: number): RatingToken | null {
  const m = TOKEN_RE.exec(text.slice(0, caret));
  if (!m) return null;
  return { start: caret - m[1].length - 1, query: m[1] };
}

export function rankRatingOptions(
  ratings: PublicRating[],
  query: string,
  limit = RATING_PICKER_LIMIT,
): PublicRating[] {
  const q = query.trim().toLowerCase();
  if (!q) return ratings.slice(0, limit);
  const starts: PublicRating[] = [];
  const contains: PublicRating[] = [];
  for (const rating of ratings) {
    const title = rating.title.toLowerCase();
    if (title.startsWith(q)) starts.push(rating);
    else if (title.includes(q)) contains.push(rating);
  }
  return [...starts, ...contains].slice(0, limit);
}
