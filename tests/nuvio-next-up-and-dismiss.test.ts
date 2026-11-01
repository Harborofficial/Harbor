import assert from "node:assert/strict";
import test from "node:test";
import { buildNuvioPlaybackItems } from "../src/lib/nuvio/nuvio-playback";
import {
  isDismissedNextUp,
  normalizeNuvioContentId,
  getNuvioContentIdVariants,
  extractCleanNumericTmdbId,
} from "../src/lib/nuvio/nuvio-sync";
import { undismissCw, isCwDismissed } from "../src/lib/cw-dismiss";
import type { NuvioWatchProgress, NuvioWatchedItem } from "../src/lib/nuvio/nuvio-types";

test("Nuvio Next Up: unwatched series with episodes marked watched immediately surfaces Next Up card", () => {
  // Empty watch progress (no active video playback timestamp)
  const records: NuvioWatchProgress[] = [];

  // Series marked watched in Nuvio Mobile: Season 1 Episode 1 watched
  const watchedItems: NuvioWatchedItem[] = [
    {
      profile_id: 0,
      content_id: "tt1234567",
      content_type: "series",
      title: "Sample Series",
      season: 1,
      episode: 1,
      watched_at: Date.now() - 10000,
    },
  ];

  const items = buildNuvioPlaybackItems(records, 0, watchedItems);

  assert.equal(items.length, 1, "Should surface exactly one Next Up card");
  const card = items[0];
  assert.equal(card._id, "tt1234567");
  assert.equal(card.type, "series");
  assert.equal(card.upNext, true);
  assert.equal(card.external, "nuvio");
  assert.equal(card.state?.season, 1);
  assert.equal(card.state?.episode, 2, "Next Up should point to Season 1 Episode 2");
  assert.equal(card.state?.timeOffset, 0, "Next Up offset should be 0");
});

test("Nuvio Next Up: active in-progress episode suppresses Next Up duplicate", () => {
  // Active in-progress episode in watch_progress (S1E2 at 50% / 1320s)
  const records: NuvioWatchProgress[] = [
    {
      profile_id: 0,
      content_id: "tt1234567",
      progress_key: "tt1234567_s1e2",
      season: 1,
      episode: 2,
      progress_seconds: 1320,
      duration_seconds: 2640,
      last_watched: Date.now(),
      name: "Sample Series",
    },
  ];

  // S1E1 marked completed in watched_items
  const watchedItems: NuvioWatchedItem[] = [
    {
      profile_id: 0,
      content_id: "tt1234567",
      content_type: "series",
      title: "Sample Series",
      season: 1,
      episode: 1,
      watched_at: Date.now() - 20000,
    },
  ];

  const items = buildNuvioPlaybackItems(records, 0, watchedItems);

  // Exactly 1 item should appear, and it must be the in-progress S1E2 with active progress
  assert.equal(items.length, 1);
  assert.equal(items[0]._id, "tt1234567");
  assert.equal(items[0].state?.season, 1);
  assert.equal(items[0].state?.episode, 2);
  assert.equal(items[0].state?.timeOffset, 1320000);
  assert.equal(items[0].upNext, false, "In-progress item should not be upNext");
});

test("Nuvio Next Up: dismissed Next-Up keys cleanly suppress cards from CW tray", () => {
  const records: NuvioWatchProgress[] = [];
  const watchedItems: NuvioWatchedItem[] = [
    {
      profile_id: 0,
      content_id: "tt1234567",
      content_type: "series",
      title: "Sample Series",
      season: 1,
      episode: 1,
      watched_at: Date.now(),
    },
  ];

  const dismissedKeys = new Set<string>(["tt1234567|1|1"]);

  // isDismissedNextUp returns true for the seed episode
  assert.equal(isDismissedNextUp("tt1234567", 1, 1, dismissedKeys), true);

  // buildNuvioPlaybackItems skips the dismissed Next Up item
  const items = buildNuvioPlaybackItems(records, 0, watchedItems, dismissedKeys);
  assert.equal(items.length, 0, "Dismissed series should not appear in Continue Watching tray");
});

test("Nuvio Next Up: fully watched series does not generate Next Up cards", () => {
  const records: NuvioWatchProgress[] = [];
  const watchedItems: NuvioWatchedItem[] = [
    {
      profile_id: 0,
      content_id: "tt7654321",
      content_type: "series",
      title: "Completed Series",
      season: null,
      episode: null,
      watched_at: Date.now(),
    },
    {
      profile_id: 0,
      content_id: "tt7654321",
      content_type: "series",
      title: "Completed Series",
      season: 1,
      episode: 1,
      watched_at: Date.now() - 1000,
    },
  ];

  const items = buildNuvioPlaybackItems(records, 0, watchedItems);
  assert.equal(items.length, 0, "Fully watched series must not appear in Continue Watching");
});

test("Nuvio Next Up: wildcard |-1|-1 dismissals and TMDB ID variants match", () => {
  // Mobile app pushes whole-series dismissal as "${contentId}|-1|-1"
  const dismissedKeys = new Set<string>(["tt9999999|-1|-1", "213375|-1|-1", "tt8888888|2|-1"]);

  // Whole series dismissal matches any episode
  assert.equal(isDismissedNextUp("tt9999999", 1, 1, dismissedKeys), true);
  assert.equal(isDismissedNextUp("tt9999999", 2, 5, dismissedKeys), true);
  assert.equal(isDismissedNextUp("tt9999999", -1, -1, dismissedKeys), true);

  // TMDB prefixed ID matches numeric key and vice versa
  assert.equal(isDismissedNextUp("tmdb:213375", 1, 1, dismissedKeys), true);
  assert.equal(isDismissedNextUp("213375", 1, 2, dismissedKeys), true);
  assert.equal(isDismissedNextUp("series:213375", 1, 1, dismissedKeys), true);

  // Season-level wildcard matches that season but not another
  assert.equal(isDismissedNextUp("tt8888888", 2, 1, dismissedKeys), true);
  assert.equal(isDismissedNextUp("tt8888888", 2, 8, dismissedKeys), true);
  assert.equal(isDismissedNextUp("tt8888888", 1, 1, dismissedKeys), false);

  // Seed episode dismissal
  const seedDismissed = new Set<string>(["tt7777777|1|2"]);
  // Target Next Up episode is S1E3, seed episode is S1E2 -> isDismissedNextUp(..., 1, 3) must be true
  assert.equal(isDismissedNextUp("tt7777777", 1, 3, seedDismissed), true);
});

test("Nuvio Next Up: unaired / upcoming series (e.g. Vision Quest) generates Next Up card and preserves metadata", () => {
  const records: NuvioWatchProgress[] = [];
  const watchedItems: NuvioWatchedItem[] = [
    {
      profile_id: 0,
      content_id: "tmdb:213375",
      content_type: "series",
      title: "Vision Quest",
      season: 1,
      episode: 1,
      watched_at: Date.now(),
    },
  ];

  const items = buildNuvioPlaybackItems(records, 0, watchedItems);
  assert.equal(items.length, 1, "Unaired next episode must generate Next Up card");
  assert.equal(items[0]._id, "tmdb:213375");
  assert.equal(items[0].name, "Vision Quest");
  assert.equal(items[0].state?.season, 1);
  assert.equal(items[0].state?.episode, 2);
  assert.equal(items[0].upNext, true);
  assert.equal(items[0].external, "nuvio");
});

test("Nuvio Next Up: undismissCw removes dismissal so newly watched episode surfaces", () => {
  undismissCw("tmdb:213375");
  undismissCw("213375");

  const records: NuvioWatchProgress[] = [];
  const watchedItems: NuvioWatchedItem[] = [
    {
      profile_id: 0,
      content_id: "tmdb:213375",
      content_type: "series",
      title: "Vision Quest",
      season: 1,
      episode: 1,
      watched_at: Date.now(),
    },
  ];

  const items = buildNuvioPlaybackItems(records, 0, watchedItems);
  assert.equal(items.length, 1);
  assert.equal(items[0]._id, "tmdb:213375");
  assert.equal(isCwDismissed(items[0]), false);
});

test("Nuvio Next Up: mixed IMDb and TMDB records for the same series produce exactly one deduplicated card", () => {
  const records: NuvioWatchProgress[] = [];
  // Cloud records contain both IMDb (tt0944947) and TMDB (tmdb:1399) representations
  const watchedItems: NuvioWatchedItem[] = [
    {
      profile_id: 0,
      content_id: "tt0944947",
      content_type: "series",
      title: "Game of Thrones",
      season: 1,
      episode: 1,
      watched_at: Date.now() - 50000,
    },
    {
      profile_id: 0,
      content_id: "tmdb:1399",
      content_type: "series",
      title: "Game of Thrones",
      season: 1,
      episode: 2,
      watched_at: Date.now() - 10000,
    },
  ];

  const items = buildNuvioPlaybackItems(records, 0, watchedItems);
  // Must NOT produce 2 cards! Exactly 1 consolidated Next Up card!
  assert.equal(
    items.length,
    1,
    "Should produce exactly 1 Next Up card for mixed IMDb/TMDB records",
  );
  assert.equal(items[0]._id, "tt0944947", "Canonical ID should prefer IMDb ID");
  assert.ok(items[0].altIds?.includes("tmdb:1399"), "Should preserve TMDB alias in altIds");
  assert.equal(items[0].state?.season, 1);
  assert.equal(
    items[0].state?.episode,
    3,
    "Should advance from the highest watched episode across both aliases (S1E2 -> S1E3)",
  );
});

test("Nuvio Next Up: in-progress episode on TMDB identity suppresses Next-Up generation for IMDb identity", () => {
  // In-progress watch progress on TMDB ID (tmdb:1399 S1E2 at 50%)
  const records: NuvioWatchProgress[] = [
    {
      profile_id: 0,
      content_id: "tmdb:1399",
      progress_key: "tmdb:1399_s1e2",
      season: 1,
      episode: 2,
      progress_seconds: 1500,
      duration_seconds: 3000,
      last_watched: Date.now(),
      name: "Game of Thrones",
    },
  ];

  // Watched item on IMDb ID (tt0944947 S1E1 completed)
  const watchedItems: NuvioWatchedItem[] = [
    {
      profile_id: 0,
      content_id: "tt0944947",
      content_type: "series",
      title: "Game of Thrones",
      season: 1,
      episode: 1,
      watched_at: Date.now() - 100000,
    },
  ];

  const items = buildNuvioPlaybackItems(records, 0, watchedItems);
  // Exactly 1 item should be returned (the active in-progress card), with no duplicate Next-Up card generated!
  assert.equal(items.length, 1);
  assert.equal(items[0].upNext, false, "In-progress item should not be upNext");
  assert.equal(items[0].state?.episode, 2);
});

test("Nuvio Next Up: in-progress episode on IMDb identity suppresses Next-Up generation for TMDB identity", () => {
  // In-progress watch progress on IMDb ID (tt0944947 S1E3 at 30%)
  const records: NuvioWatchProgress[] = [
    {
      profile_id: 0,
      content_id: "tt0944947",
      progress_key: "tt0944947_s1e3",
      season: 1,
      episode: 3,
      progress_seconds: 900,
      duration_seconds: 3000,
      last_watched: Date.now(),
      name: "Game of Thrones",
    },
  ];

  // Watched item on TMDB ID (tmdb:1399 S1E2 completed)
  const watchedItems: NuvioWatchedItem[] = [
    {
      profile_id: 0,
      content_id: "tmdb:1399",
      content_type: "series",
      title: "Game of Thrones",
      season: 1,
      episode: 2,
      watched_at: Date.now() - 50000,
    },
  ];

  const items = buildNuvioPlaybackItems(records, 0, watchedItems);
  assert.equal(items.length, 1);
  assert.equal(items[0].upNext, false);
  assert.equal(items[0].state?.episode, 3);
});

test("Nuvio Next Up: dismissing via TMDB identity dismisses the candidate even when watched via IMDb", () => {
  const records: NuvioWatchProgress[] = [];
  const watchedItems: NuvioWatchedItem[] = [
    {
      profile_id: 0,
      content_id: "tt0944947",
      content_type: "series",
      title: "Game of Thrones",
      season: 1,
      episode: 1,
      watched_at: Date.now(),
    },
  ];

  // Dismissed via TMDB key
  const dismissedKeys = new Set<string>(["tmdb:1399|1|1"]);
  const items = buildNuvioPlaybackItems(records, 0, watchedItems, dismissedKeys, false, {
    tt0944947: "tmdb:1399",
  });
  assert.equal(
    items.length,
    0,
    "Dismissing via TMDB alias must suppress Next-Up card for IMDb record",
  );
});

test("Nuvio ID normalization: extracts numeric TMDB ID and prevents tmdb:tv: from leaking to Nuvio Cloud", () => {
  // 1. extractCleanNumericTmdbId
  assert.equal(extractCleanNumericTmdbId("tmdb:tv:96677"), "96677");
  assert.equal(extractCleanNumericTmdbId("tmdb:movie:12345"), "12345");
  assert.equal(extractCleanNumericTmdbId("tmdb:96677"), "96677");
  assert.equal(extractCleanNumericTmdbId("series:96677"), "96677");
  assert.equal(extractCleanNumericTmdbId("96677"), "96677");
  assert.equal(extractCleanNumericTmdbId("tt2531336"), null);

  // 2. normalizeNuvioContentId
  // tmdb:tv:96677 must be normalized to tmdb:96677 so Nuvio Mobile's substringAfter(':').substringBefore(':').toIntOrNull() succeeds
  const normTv = normalizeNuvioContentId("tmdb:tv:96677");
  assert.ok(
    normTv === "tmdb:96677" || normTv.startsWith("tt"),
    `Expected tmdb:96677 or tt..., got ${normTv}`,
  );
  assert.equal(normTv.includes(":tv:"), false, "Must never contain :tv: in Nuvio Cloud payload");

  // tmdb:movie:12345 must not leak :movie:
  const normMovie = normalizeNuvioContentId("tmdb:movie:12345");
  assert.ok(
    normMovie === "tmdb:12345" || normMovie.startsWith("tt"),
    `Expected tmdb:12345 or tt..., got ${normMovie}`,
  );
  assert.equal(
    normMovie.includes(":movie:"),
    false,
    "Must never contain :movie: in Nuvio Cloud payload",
  );

  // IMDb IDs remain untouched
  assert.equal(normalizeNuvioContentId("tt2531336"), "tt2531336");
});

test("Nuvio ID normalization: getNuvioContentIdVariants includes all alias variants for deletion and dismissal", () => {
  const variants = getNuvioContentIdVariants("tmdb:tv:96677");
  assert.ok(variants.includes("tmdb:tv:96677"));
  assert.ok(variants.includes("tmdb:96677"));
  assert.ok(variants.includes("96677"));
  assert.ok(variants.includes("series:96677"));

  // Dismissal check handles cross-variant matching seamlessly
  const dismissedKeys = new Set<string>(["tmdb:96677|-1|-1"]);
  assert.equal(isDismissedNextUp("tmdb:tv:96677", 1, 1, dismissedKeys), true);
  assert.equal(isDismissedNextUp("96677", 1, 1, dismissedKeys), true);
});
