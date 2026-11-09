import assert from "node:assert/strict";
import test from "node:test";
import {
  composeQuotedBody,
  encodeRatingQuote,
  parseQuotedBody,
  ratingQuoteLength,
  type RatingQuote,
} from "../src/lib/ratings/quote";
import { rankRatingOptions, ratingToken, withoutRatingToken } from "../src/lib/ratings/trigger";
import type { PublicRating } from "../src/lib/ratings/types";
import { scanMentions } from "../src/lib/social/mentions";
import { COMMENT_MAX, stripUrls, validateComment } from "../src/views/profile/text-safety";

const quote: RatingQuote = {
  authorHandle: "alice",
  itemKey: "tt0903747",
  mediaType: "series",
  score: 8.5,
};

test("a quoted rating round-trips through the comment body", () => {
  const body = composeQuotedBody(quote, "  the pacing in season two drags  ");
  const parsed = parseQuotedBody(body);
  assert.deepEqual(parsed.quote, quote);
  assert.equal(parsed.text, "the pacing in season two drags");
});

test("a comment without a marker keeps its body untouched", () => {
  const body = "I think @alice is being too harsh";
  const parsed = parseQuotedBody(body);
  assert.equal(parsed.quote, null);
  assert.equal(parsed.text, body);
});

test("a marker that is not at the start of the body is left as text", () => {
  const marker = encodeRatingQuote(quote);
  const parsed = parseQuotedBody(`Agree with ${marker}`);
  assert.equal(parsed.quote, null);
  assert.equal(parsed.text, `Agree with ${marker}`);
});

test("a broken marker falls back to plain text", () => {
  for (const body of ["[[rq:@alice|tt0903747|series]] x", "[[rq:@al|tt0903747|series|8]] x"]) {
    const parsed = parseQuotedBody(body);
    assert.equal(parsed.quote, null);
    assert.equal(parsed.text, body);
  }
});

test("title keys with separators inside them still parse", () => {
  const episodic: RatingQuote = { ...quote, itemKey: "tt0903747:1:2", mediaType: "anime" };
  const parsed = parseQuotedBody(composeQuotedBody(episodic, "still a banger"));
  assert.deepEqual(parsed.quote, episodic);
  assert.equal(parsed.text, "still a banger");
});

test("scores are clamped and snapped to the half-star scale", () => {
  const score = (value: number) =>
    parseQuotedBody(composeQuotedBody({ ...quote, score: value }, "x")).quote?.score;
  assert.equal(score(12), 10);
  assert.equal(score(0), 0.5);
  assert.equal(score(7.3), 7.5);
  assert.equal(score(6), 6);
});

test("the comment sanitizer leaves the marker readable and mentions the rater", () => {
  const body = composeQuotedBody(quote, "Season two drags a bit");
  assert.equal(stripUrls(body), body);
  assert.deepEqual(scanMentions(body).notified, ["alice"]);
});

const rating = (itemKey: string, title: string, score = 8): PublicRating => ({
  itemKey,
  mediaType: "movie",
  score,
  title,
  at: "2026-01-01",
});

test("typing # at the caret starts the rating trigger", () => {
  assert.deepEqual(ratingToken("I think #", 9), { start: 8, query: "" });
  assert.deepEqual(ratingToken("I think #the", 12), { start: 8, query: "the" });
  // The query runs through spaces, so a multi-word title can be typed: "#blue heron".
  assert.deepEqual(ratingToken("#1 of the year", 14), { start: 0, query: "1 of the year" });
});

test("a # inside a word does not start the trigger", () => {
  assert.equal(ratingToken("C#", 2), null);
  assert.equal(ratingToken("no trigger here", 10), null);
});

test("the trigger only reads the text before the caret", () => {
  assert.deepEqual(ratingToken("#bear and the rest", 5), { start: 0, query: "bear" });
});

test("picking a rating leaves the author's words without the typed trigger", () => {
  assert.deepEqual(withoutRatingToken("I think #the bear drags", 12, 8), {
    text: "I think bear drags",
    caret: 8,
  });
  assert.deepEqual(withoutRatingToken("#bear", 5, 0), { text: "", caret: 0 });
  assert.deepEqual(withoutRatingToken("#bear and more", 5, 0), {
    text: "and more",
    caret: 0,
  });
});

test("rating options put title prefixes first and cap the list", () => {
  const ratings = [
    rating("a", "The Bear"),
    rating("b", "Bear Island"),
    rating("c", "Paddington Bear"),
    rating("d", "Barbie"),
    rating("e", "Babe"),
    rating("f", "Batman"),
    rating("g", "Bolt"),
  ];
  assert.deepEqual(
    rankRatingOptions(ratings, "be").map((r) => r.itemKey),
    ["b", "a", "c", "e"],
  );
  assert.equal(rankRatingOptions(ratings, "").length, 6);
  assert.deepEqual(
    rankRatingOptions(ratings, "", 2).map((r) => r.itemKey),
    ["a", "b"],
  );
});

test("the marker counts against the comment limit", () => {
  const leftover = COMMENT_MAX - ratingQuoteLength(quote);
  const now = 100000;
  const words = "the pacing drags ".repeat(leftover).slice(0, leftover);
  assert.equal(validateComment(words, 0, now, leftover), null);
  assert.equal(validateComment(`${words} a`, 0, now, leftover), "too-long");
  assert.equal(validateComment("   ", 0, now, leftover), "empty");
});
