import assert from "node:assert/strict";
import test from "node:test";
import { movieReleaseDates } from "../src/lib/providers/tmdb/movie-release-dates.ts";

test("movie countdowns distinguish theatrical and digital releases in the chosen region", () => {
  const releases = movieReleaseDates(
    [
      {
        iso_3166_1: "US",
        release_dates: [
          { type: 1, release_date: "2026-09-01T00:00:00Z" },
          { type: 3, release_date: "2026-10-01T00:00:00Z" },
          { type: 4, release_date: "2026-11-01T00:00:00Z" },
          { type: 5, release_date: "2026-10-15T00:00:00Z" },
        ],
      },
      {
        iso_3166_1: "GB",
        release_dates: [
          { type: 3, release_date: "2026-10-08T00:00:00Z" },
          { type: 4, release_date: "2026-11-08T00:00:00Z" },
        ],
      },
    ],
    "gb",
  );
  assert.deepEqual(releases, [
    { kind: "cinema", date: "2026-10-08", country: "GB" },
    { kind: "digital", date: "2026-11-08", country: "GB" },
  ]);
});

test("missing regional dates retain the actual country of the fallback release", () => {
  assert.deepEqual(
    movieReleaseDates(
      [
        {
          iso_3166_1: "US",
          release_dates: [
            { type: 4, release_date: "unknown" },
            { type: 4, release_date: "2026-11-01T00:00:00Z" },
          ],
        },
      ],
      "GB",
    ),
    [{ kind: "digital", date: "2026-11-01", country: "US" }],
  );
  assert.deepEqual(movieReleaseDates([], "US"), []);
});
