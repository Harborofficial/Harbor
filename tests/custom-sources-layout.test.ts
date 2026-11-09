import assert from "node:assert/strict";
import test from "node:test";
import {
  folderLayout,
  tmdbSourceParams,
  updateSourceFolder,
  type SourceRow,
} from "../src/lib/custom-sources";

const folder = (id: string, layout?: "CLASSIC" | "GRID") => ({
  id,
  title: id,
  coverImageUrl: null,
  focusGifUrl: null,
  tileShape: "POSTER" as const,
  layout,
  sources: [{ title: id, provider: "tmdb", mediaType: "MOVIE" }],
});

const row = (id: string, folderIds: string[]): SourceRow => ({
  id,
  title: id,
  folders: folderIds.map((f) => folder(f)),
});

test("updateSourceFolder only touches the matching folder", () => {
  const before = [row("a", ["a1", "a2"]), row("b", ["b1"])];
  const after = updateSourceFolder(before, "a", "a2", { layout: "GRID" });

  assert.equal(after[0].folders[1].layout, "GRID");
  assert.equal(after[0].folders[0].layout, undefined);
  assert.equal(after[1].folders[0].layout, undefined);
  // untouched originals keep their identity
  assert.equal(before[0].folders[1].layout, undefined);
  assert.equal(after[1], before[1]);
});

test("updateSourceFolder ignores the same folder id in another row", () => {
  const before = [row("a", ["shared"]), row("b", ["shared"])];
  const after = updateSourceFolder(before, "a", "shared", { layout: "GRID" });

  assert.equal(after[0].folders[0].layout, "GRID");
  assert.equal(after[1].folders[0].layout, undefined);
  assert.equal(before[1].folders[0].layout, undefined);
});

test("folderLayout returns the saved layout or undefined", () => {
  const rows = [
    { ...row("a", ["a1"]), folders: [folder("a1", "GRID")] },
    { ...row("b", ["a1"]), folders: [folder("a1", "CLASSIC")] },
  ];

  assert.equal(folderLayout(rows, "a", "a1"), "GRID");
  assert.equal(folderLayout(rows, "b", "a1"), "CLASSIC");
  assert.equal(folderLayout(rows, "missing", "a1"), undefined);
  assert.equal(folderLayout(rows, "a", "missing"), undefined);
  assert.equal(folderLayout([], "a", "a1"), undefined);
});

test("tmdbSourceParams maps filters and company", () => {
  const params = tmdbSourceParams(
    {
      mediaType: "TV",
      sortBy: "popularity.desc",
      filters: { year: 2004, voteCountGte: 50, voteAverageGte: 7, withGenres: 18 },
      tmdbSourceType: "DISCOVER",
    },
    3,
  );

  assert.deepEqual(params, {
    page: "3",
    sort_by: "popularity.desc",
    first_air_date_year: "2004",
    "vote_count.gte": "50",
    "vote_average.gte": "7",
    with_genres: "18",
  });

  assert.deepEqual(
    tmdbSourceParams({ mediaType: "MOVIE", tmdbSourceType: "COMPANY", tmdbId: 420 }, 1),
    { page: "1", with_companies: "420" },
  );
});
