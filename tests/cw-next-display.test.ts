import assert from "node:assert/strict";
import test from "node:test";
import { cwNextDisplayCoords } from "../src/lib/cw-next-display.ts";

test("Black Clover 2nd Season E4 never inherits a stale season-zero special label", () => {
  assert.deepEqual(
    cwNextDisplayCoords(
      { season: 0, episode: 3 },
      { season: 1, episode: 3 },
      { season: 1, episode: 4, imdbSeason: 2, imdbEpisode: 4 },
      false,
    ),
    { season: 2, episode: 4 },
  );
});

test("an explicit stored special is repaired even when stream decoding implied season one", () => {
  assert.deepEqual(
    cwNextDisplayCoords(
      { season: 1, episode: 3 },
      { season: 1, episode: 3 },
      { season: 1, episode: 4, imdbSeason: 2, imdbEpisode: 4 },
      false,
      true,
    ),
    { season: 2, episode: 4 },
  );
});

test("regular cour coordinates and mixed split-season behavior remain intact", () => {
  assert.deepEqual(
    cwNextDisplayCoords(
      { season: 2, episode: 3 },
      { season: 2, episode: 3 },
      { season: 1, episode: 4, imdbSeason: 2, imdbEpisode: 4 },
      false,
    ),
    { season: 1, episode: 4 },
  );
  assert.deepEqual(
    cwNextDisplayCoords(
      { season: 2, episode: 3 },
      { season: 1, episode: 3 },
      { season: 1, episode: 4 },
      true,
    ),
    { season: 1, episode: 4 },
  );
});

test("season-zero specials without verified regular provider coordinates are preserved", () => {
  assert.deepEqual(
    cwNextDisplayCoords(
      { season: 0, episode: 2 },
      { season: 0, episode: 2 },
      { season: 0, episode: 3 },
      false,
    ),
    { season: 0, episode: 3 },
  );
});
