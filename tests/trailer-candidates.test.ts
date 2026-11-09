import assert from "node:assert/strict";
import test from "node:test";
import { mergeAnimeDetailExtras } from "../src/lib/providers/anime-detail-extras.ts";
import { mergeTrailerCandidates } from "../src/lib/trailer-candidates.ts";

test("merges trailer candidates in source order without duplicates", () => {
  assert.deepEqual(
    mergeTrailerCandidates(["tmdb1", "anime"], ["", " tmdb1 ", "tmdb2"], undefined, [
      "anime",
      "extra",
    ]),
    ["tmdb1", "anime", "tmdb2", "extra"],
  );
  assert.deepEqual(mergeTrailerCandidates(undefined, [], null), []);
});

test("anime extras replace the single source trailer with the merged list", () => {
  const base = {
    gallery: { backdrops: [], posters: [], logos: [] },
    trailerYtId: "private",
    trailerCandidates: ["private"],
  } as any;
  const merged = mergeAnimeDetailExtras(base, {
    trailerYtId: "tmdb",
    trailerCandidates: ["tmdb", "private"],
  });
  assert.equal(merged.trailerYtId, "tmdb");
  assert.deepEqual(merged.trailerCandidates, ["tmdb", "private"]);
});
