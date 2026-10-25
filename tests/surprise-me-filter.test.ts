import assert from "node:assert/strict";
import test from "node:test";
import type { Meta } from "../src/lib/cinemeta.ts";
import {
  filterSurprisePool,
  type SurpriseWatchedSources,
} from "../src/views/discover/surprise-me-filter.ts";

const movie = (id: string): Meta => ({ id, type: "movie", name: id }) as Meta;
const show = (id: string): Meta => ({ id, type: "series", name: id }) as Meta;
const sources = (
  values: Partial<Record<keyof SurpriseWatchedSources, string[]>> = {},
): SurpriseWatchedSources => ({
  watchedFlags: new Set(values.watchedFlags ?? []),
  movieWatched: new Set(values.movieWatched ?? []),
  externalWatched: new Set(values.externalWatched ?? []),
  stremioWatched: new Set(values.stremioWatched ?? []),
});

test("Surprise Me includes watched movies when the toggle is off", () => {
  const pool = [movie("tt100"), movie("tt200"), show("tt300")];
  const result = filterSurprisePool(
    pool,
    false,
    sources({ watchedFlags: ["tt100"], movieWatched: ["tt200"] }),
  );
  assert.strictEqual(result, pool);
});

test("Surprise Me excludes watched movies from each completed-watch source", () => {
  const pool = [
    movie("tt100"),
    movie("tmdb:movie:200"),
    movie("tmdb:movie:300"),
    movie("tt400"),
    movie("tt500"),
    show("tt600"),
  ];
  const result = filterSurprisePool(
    pool,
    true,
    sources({
      watchedFlags: ["tt100"],
      movieWatched: ["tmdb:movie:200"],
      externalWatched: ["tmdb:movie:300"],
      stremioWatched: ["tt400"],
    }),
  );
  assert.deepEqual(
    result.map((meta) => meta.id),
    ["tt500", "tt600"],
  );
});

test("Surprise Me keeps series eligible when excluding watched movies", () => {
  const pool = [movie("tt100"), show("tt100"), show("tt200")];
  const result = filterSurprisePool(
    pool,
    true,
    sources({
      watchedFlags: ["tt100", "tt200"],
    }),
  );
  assert.deepEqual(
    result.map((meta) => [meta.id, meta.type]),
    [
      ["tt100", "series"],
      ["tt200", "series"],
    ],
  );
});

test("Surprise Me returns no picks if all movies have been watched", () => {
  assert.deepEqual(
    filterSurprisePool(
      [movie("tt1"), movie("tt2")],
      true,
      sources({
        movieWatched: ["tt1", "tt2"],
      }),
    ),
    [],
  );
  assert.deepEqual(filterSurprisePool([], true, sources()), []);
});
