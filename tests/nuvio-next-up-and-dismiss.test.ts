import assert from "node:assert/strict";
import test from "node:test";
import { buildNuvioPlaybackItems } from "../src/lib/nuvio/nuvio-playback";
import { isDismissedNextUp } from "../src/lib/nuvio/nuvio-sync";
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
  const dismissedKeys = new Set<string>([
    "tt9999999|-1|-1",
    "213375|-1|-1",
    "tt8888888|2|-1",
  ]);

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
