import assert from "node:assert/strict";
import test from "node:test";
import { selectQueueEpisode } from "../src/lib/queue-episode";
import type { PlayEpisode } from "../src/lib/view";

const episodes: PlayEpisode[] = [
  { season: 1, episode: 1 },
  { season: 1, episode: 2 },
  { season: 2, episode: 1 },
];

test("explicit selection wins even when already watched", () => {
  const explicit: PlayEpisode = {
    season: 0,
    episode: 1,
    videoId: "special-video",
  };

  const selected = selectQueueEpisode({
    explicitEpisode: explicit,
    episodes,
    progress: episodes[1],
    isWatched: () => true,
  });

  assert.equal(selected, explicit);
});

test("a new series starts with its first regular episode", () => {
  const selected = selectQueueEpisode({
    episodes: [episodes[2], { season: 0, episode: 1 }, episodes[1], episodes[0]],
    progress: null,
    isWatched: () => false,
  });

  assert.equal(selected, episodes[0]);
});

test("an unfinished episode remains the selected episode", () => {
  const selected = selectQueueEpisode({
    episodes,
    progress: episodes[1],
    isWatched: (season, episode) => season === 1 && episode === 1,
  });

  assert.equal(selected, episodes[1]);
});

test("a completed season advances to the next season", () => {
  const selected = selectQueueEpisode({
    episodes,
    progress: episodes[1],
    isWatched: (season) => season === 1,
  });

  assert.equal(selected, episodes[2]);
});

test("unmatched progress does not restart the series", () => {
  const selected = selectQueueEpisode({
    episodes,
    progress: { season: 4, episode: 8 },
    isWatched: () => false,
  });

  assert.equal(selected, null);
});

test("a fully watched series has no automatic selection", () => {
  const selected = selectQueueEpisode({
    episodes,
    progress: episodes[2],
    isWatched: () => true,
  });

  assert.equal(selected, null);
});

test("an episode with a known future air date is not selected", () => {
  const selected = selectQueueEpisode({
    episodes: [
      { season: 1, episode: 1, airDate: "2026-01-01" },
      { season: 1, episode: 2, airDate: "2026-12-01" },
    ],
    progress: { season: 1, episode: 1 },
    isWatched: (_season, episode) => episode === 1,
    now: Date.parse("2026-06-01"),
  });

  assert.equal(selected, null);
});

test("selection preserves playback identifiers and episode metadata", () => {
  const episode: PlayEpisode = {
    season: 1,
    episode: 3,
    kitsuStreamId: "kitsu:123:3",
    imdbId: "tt1234567",
    imdbSeason: 2,
    imdbEpisode: 3,
    name: "Episode title",
  };

  const selected = selectQueueEpisode({
    episodes: [episode],
    progress: null,
    isWatched: () => false,
  });

  assert.equal(selected, episode);
});
