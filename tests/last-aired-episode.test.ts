// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import test from "node:test";
import { isLastAiredEpisode } from "../src/lib/player/last-aired-episode.ts";

const now = Date.parse("2026-01-10T12:00:00Z");
const episodes = [
  { season: 1, episode: 1, airDate: "2026-01-01T00:00:00Z" },
  { season: 1, episode: 2, airDate: "2026-01-08T00:00:00Z" },
  { season: 1, episode: 3, airDate: "2026-01-15T00:00:00Z" },
  { season: 1, episode: 4 },
];

test("accepts the latest aired episode while later episodes are scheduled", () => {
  assert.equal(isLastAiredEpisode(episodes, episodes[1], now), true);
});

test("rejects earlier and future episodes", () => {
  assert.equal(isLastAiredEpisode(episodes, episodes[0], now), false);
  assert.equal(isLastAiredEpisode(episodes, episodes[2], now), false);
  assert.equal(isLastAiredEpisode(episodes, episodes[3], now), false);
});

test("ignores future and undated later episodes", () => {
  assert.equal(isLastAiredEpisode(episodes.slice(0, 3), episodes[1], now), true);
  assert.equal(isLastAiredEpisode([episodes[1], episodes[3]], episodes[1], now), true);
});

test("rejects when no episode has a valid air date", () => {
  assert.equal(
    isLastAiredEpisode([{ season: 1, episode: 1 }], { season: 1, episode: 1 }, now),
    false,
  );
});
