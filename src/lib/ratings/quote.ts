import type { RatingMediaType } from "./types";

/**
 * A comment can quote one of the profile owner's ratings so the author can reply to the review
 * itself. Comments are plain text on the social API, so the reference travels as an ASCII marker
 * at the start of the body and the app renders it as a poster card.
 *
 * The marker embeds the rater's @handle, which keeps the existing mention delivery working: the
 * quoted rater is mentioned by the comment that quotes them.
 */
export type RatingQuote = {
  authorHandle: string;
  itemKey: string;
  mediaType: RatingMediaType;
  score: number;
};

const QUOTE_RE =
  /^\[\[rq:@([A-Za-z0-9][A-Za-z0-9-]{1,22}[A-Za-z0-9])\|([^|\s]{1,120})\|(movie|series|anime|manga)\|(\d{1,2}(?:\.\d)?)\]\] ?/;

function cleanScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.min(10, Math.max(0.5, Math.round(score * 2) / 2));
}

export function encodeRatingQuote(quote: RatingQuote): string {
  return `[[rq:@${quote.authorHandle}|${quote.itemKey}|${quote.mediaType}|${cleanScore(quote.score)}]]`;
}

/** The body the comment is posted with: the quote marker first, then what the author wrote. */
export function composeQuotedBody(quote: RatingQuote, text: string): string {
  return `${encodeRatingQuote(quote)} ${text.trim()}`;
}

/** Splits a stored body into the quoted rating, when there is one, and the author's own words. */
export function parseQuotedBody(body: string): { quote: RatingQuote | null; text: string } {
  const match = QUOTE_RE.exec(body);
  if (!match) return { quote: null, text: body };
  return {
    quote: {
      authorHandle: match[1],
      itemKey: match[2],
      mediaType: match[3] as RatingMediaType,
      score: Number(match[4]),
    },
    text: body.slice(match[0].length),
  };
}

/** Characters a quote takes out of the comment limit, including its separating space. */
export function ratingQuoteLength(quote: RatingQuote): number {
  return encodeRatingQuote(quote).length + 1;
}

/** Builds the quote for a rating the author picked, attributed to the profile owner. */
export function ratingQuoteFrom(
  rating: { itemKey: string; mediaType: RatingMediaType; score: number },
  authorHandle: string,
): RatingQuote {
  return {
    authorHandle,
    itemKey: rating.itemKey,
    mediaType: rating.mediaType,
    score: rating.score,
  };
}
