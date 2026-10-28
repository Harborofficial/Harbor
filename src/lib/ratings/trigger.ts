import type { PublicRating } from "./types";
export const RATING_PICKER_LIMIT = 6;

// A "#" the author types at the caret starts the rating trigger. A leading word character keeps
// "#" inside something like "C#" from opening the picker.
// Allow spaces in queries so "#Blue Heron" captures the full show name.
const TOKEN_RE = /(?:^|[^A-Za-z0-9_@#/])#([^#]{0,80})$/;

export type RatingToken = { start: number; query: string };

/** A person whose ratings the composer can quote from. */
export type RatingSource = {
  handle: string;
  label?: string;
  kind: "owner" | "me" | "friend" | "any";
  avatarUrl?: string;
  online?: boolean;
};

/** What a person's row calls them; the profile owner and the author get plain words. */
export function sourceLabel(source: RatingSource, t: (key: string) => string): string {
  if (source.kind === "owner") return t("This profile");
  if (source.kind === "me") return t("You");
  return source.label || `@${source.handle}`;
}

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
    // Match if query appears at the start of the title (prioritized)
    if (title.startsWith(q)) starts.push(rating);
    // Also match if query appears anywhere in the title
    else if (title.includes(q)) contains.push(rating);
  }
  return [...starts, ...contains].slice(0, limit);
}
