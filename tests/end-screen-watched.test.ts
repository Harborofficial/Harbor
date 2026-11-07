import assert from "node:assert/strict";
import test from "node:test";
import type { Meta } from "../src/lib/cinemeta.ts";
import { filterUnwatchedRecommendations } from "../src/lib/player/end-screen-watched.ts";

const movie = (id: string, name = id): Meta => ({ id, type: "movie", name }) as Meta;
const show = (id: string, name = id): Meta => ({ id, type: "series", name }) as Meta;

test("end screen keeps every recommendation when the option is off", () => {
  const items = [movie("tt100"), show("tt200")];
  const result = filterUnwatchedRecommendations(items, false, {
    movieWatched: new Set(["tt100"]),
  });
  assert.strictEqual(result, items);
});

test("end screen drops movies and shows from local watch flags", () => {
  const result = filterUnwatchedRecommendations(
    [movie("tt100"), show("tt200"), movie("tt300")],
    true,
    {
      watchedFlags: new Set(["tt100"]),
      movieWatched: new Set(["tt200"]),
    },
  );
  assert.deepEqual(
    result.map((item) => item.id),
    ["tt300"],
  );
});

test("end screen drops titles watched through Trakt or Simkl keys", () => {
  const result = filterUnwatchedRecommendations(
    [movie("tt100"), show("tt200"), show("tmdb:tv:300")],
    true,
    {
      traktKeys: new Set(["imdb:tt100", "imdb:tt200", "tmdb:tv:300"]),
    },
  );
  assert.deepEqual(result, []);
});

test("end screen drops titles from local playback history by id and title", () => {
  const result = filterUnwatchedRecommendations(
    [movie("tt100"), movie("tt200", "The Watched One"), movie("tt300")],
    true,
    {
      localWatched: {
        ids: new Set(["tt100"]),
        titles: new Set(["thewatchedone"]),
      },
    },
  );
  assert.deepEqual(
    result.map((item) => item.id),
    ["tt300"],
  );
});
