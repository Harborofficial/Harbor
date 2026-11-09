// @ts-expect-error Node test types are outside the browser tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are outside the browser tsconfig.
import test from "node:test";
import { rememberAnimeTitle } from "../src/lib/anime-title-key.ts";
import { rememberCardCoords } from "../src/lib/cw-card-coords.ts";
import { dedupeCwItems } from "../src/lib/cw-dedupe.ts";
import type { LibraryItem } from "../src/lib/stremio.ts";

const item = (id: string, name: string, type = "movie"): LibraryItem =>
  ({ _id: id, name, type }) as LibraryItem;

const series = (
  id: string,
  name: string,
  season: number,
  episode: number,
  timeOffset: number,
  duration = 1000,
): LibraryItem =>
  ({
    _id: id,
    name,
    type: "series",
    state: { season, episode, timeOffset, duration },
  }) as LibraryItem;

test("the same title from two sources keeps one card", () => {
  const out = dedupeCwItems([item("tt1", "Michael"), item("tmdb:1", "Michael")], 16);
  assert.deepEqual(
    out.map((i) => i._id),
    ["tt1"],
  );
});

test("a franchise suffix does not count as a different title", () => {
  const out = dedupeCwItems([item("tt1", "Michael"), item("tt2", "Michael Season 2")], 16);
  assert.equal(out.length, 1);
});

test("a stale earlier episode is replaced by the current one", () => {
  const stale = series("tt1", "Show", 2, 1, 100);
  const current = series("tt2", "Show Season 3", 3, 7, 0);
  const out = dedupeCwItems([stale, current], 16);
  assert.deepEqual(
    out.map((i) => i._id),
    ["tt2"],
  );
  assert.deepEqual(
    out[0].cwMembers?.map((i) => i._id),
    ["tt2", "tt1"],
  );
});

test("a series row and an anime row with the same title collapse", () => {
  const out = dedupeCwItems(
    [
      series("tt1", "Frieren: Beyond Journey's End", 1, 9, 100),
      { ...series("kitsu:1", "Frieren: Beyond Journey's End", 2, 9, 100), type: "anime" },
    ],
    16,
  );
  assert.deepEqual(
    out.map((i) => [i._id, i.state?.season, i.state?.episode]),
    [["kitsu:1", 2, 9]],
  );
});

test("rows sharing an alternate id collapse even when their titles differ", () => {
  const out = dedupeCwItems(
    [
      { ...series("tt1", "Frieren", 1, 9, 100), altIds: ["kitsu:1"] },
      series("kitsu:1", "Sousou no Frieren", 2, 9, 100),
    ],
    16,
  );
  assert.deepEqual(
    out.map((i) => [i._id, i.state?.season, i.state?.episode]),
    [["kitsu:1", 2, 9]],
  );
});

test("a card's resolved title dedupes sources whose stored names differ", () => {
  const library = series("tt1", "Sousou no Frieren", 1, 9, 100);
  const anime = {
    ...series("kitsu:1", "Frieren: Beyond Journey's End", 2, 9, 100),
    type: "anime",
  };
  const checkpoint = (item: LibraryItem) => ({
    videoId: item.state?.video_id,
    season: item.state?.season,
    episode: item.state?.episode,
    imdbId: item._id.startsWith("tt") ? item._id : undefined,
  });
  assert.equal(
    rememberAnimeTitle(library._id, "Frieren: Beyond Journey's End", checkpoint(library)),
    true,
  );
  assert.equal(
    rememberAnimeTitle(anime._id, "Frieren: Beyond Journey's End", checkpoint(anime)),
    true,
  );
  assert.equal(
    rememberAnimeTitle(library._id, "Frieren: Beyond Journey's End", checkpoint(library)),
    false,
    "re-resolving the same title must not notify again",
  );
  const out = dedupeCwItems([library, anime], 16);
  assert.deepEqual(
    out.map((i) => [i._id, i.state?.season, i.state?.episode]),
    [["kitsu:1", 2, 9]],
  );
});

test("the displayed season decides which anime copy survives", () => {
  // Both rows store S1E9; only the card mapping knows one is the S2 cour. The
  // S1 copy has further progress, but the later season must still win.
  const seasonOne = series("kitsu:1", "Frieren: Beyond Journey's End", 1, 9, 400);
  const seasonTwo = series("kitsu:2", "Frieren: Beyond Journey's End", 1, 9, 100);
  rememberCardCoords(seasonOne, { season: 1, episode: 9 });
  rememberCardCoords(seasonTwo, { season: 2, episode: 9 });
  const out = dedupeCwItems([seasonOne, seasonTwo], 16);
  assert.deepEqual(
    out.map((i) => i._id),
    ["kitsu:2"],
  );
});

test("the same show from two seasons collapses to the later episode", () => {
  const out = dedupeCwItems(
    [
      series("kitsu:1", "Frieren: Beyond Journey's End", 1, 9, 100),
      series("kitsu:2", "Frieren: Beyond Journey's End Season 2", 2, 9, 100),
    ],
    16,
  );
  assert.deepEqual(
    out.map((i) => [i._id, i.state?.season, i.state?.episode]),
    [["kitsu:2", 2, 9]],
  );
});

test("the same episode keeps the copy with further progress", () => {
  const out = dedupeCwItems(
    [series("tt1", "Show", 1, 2, 100), series("tt2", "Show", 1, 2, 400)],
    16,
  );
  assert.deepEqual(
    out.map((i) => i._id),
    ["tt2"],
  );
});

test("a current copy arriving after the limit still replaces a stale duplicate", () => {
  const out = dedupeCwItems(
    [
      series("tt1", "Show", 1, 1, 0),
      item("tt2", "Other", "series"),
      series("tt3", "Show", 1, 5, 0),
    ],
    2,
  );
  assert.deepEqual(
    out.map((i) => i._id),
    ["tt3", "tt2"],
  );
});

test("same name but a different media type stays separate", () => {
  const out = dedupeCwItems([item("tt1", "Michael"), item("tt2", "Michael", "series")], 16);
  assert.equal(out.length, 2);
});

test("unnamed entries and the limit are both kept", () => {
  const out = dedupeCwItems([item("a", ""), item("b", ""), item("c", "Other")], 2);
  assert.deepEqual(
    out.map((i) => i._id),
    ["a", "b"],
  );
});
