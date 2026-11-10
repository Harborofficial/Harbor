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
  lastWatched?: string,
): LibraryItem =>
  ({
    _id: id,
    name,
    type: "series",
    state: { season, episode, timeOffset, duration, ...(lastWatched ? { lastWatched } : {}) },
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

test("a stale earlier episode is replaced by the current verified copy", () => {
  // Same content id: the dropped copy is safe to include in the dismissal group.
  const stale = { ...series("tt1", "Show", 2, 1, 100), altIds: ["tt2"] };
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
  assert.ok(out[0].altIds?.includes("tt1"), "verified copies keep each other's ids");
});

test("a title-only duplicate is shown but owns no other show's progress", () => {
  // Two different shows that share a title (The Office US/UK). One card is fine;
  // a dismissal of it must not clear the other show's saved position.
  const us = series("tt0386676", "The Office", 2, 1, 100);
  const uk = series("tt0290978", "The Office", 3, 7, 100);
  const out = dedupeCwItems([us, uk], 16);
  assert.deepEqual(
    out.map((i) => i._id),
    ["tt0290978"],
    "the further episode is still the one shown",
  );
  assert.equal(out[0].cwMembers, undefined, "no dismissal ownership across a title match");
  assert.equal(out[0].altIds, undefined, "no verified alias across a title match");
});

test("an id seen only on a collapsed duplicate still finds the card", () => {
  const first = series("tt1", "Show", 2, 1, 100);
  const duplicate = series("tt2", "Show Season 2", 3, 7, 100);
  const hiddenTwin = { ...series("tt3", "Unrelated Stored Name", 3, 7, 100), altIds: ["tt2"] };
  const out = dedupeCwItems([first, duplicate, hiddenTwin], 16);
  assert.equal(out.length, 1, "the twin of the collapsed copy joins the same card");
  assert.deepEqual(
    out[0].cwMembers?.map((i) => i._id),
    ["tt2", "tt3"],
    "only the copies that share an id with the shown card are owned",
  );
  assert.ok(!out[0].cwMembers?.some((i) => i._id === "tt1"));
});

test("same episode keeps the copy with further progress", () => {
  const out = dedupeCwItems(
    [series("tt1", "Show", 1, 2, 100), series("tt2", "Show", 1, 2, 400)],
    16,
  );
  assert.deepEqual(
    out.map((i) => i._id),
    ["tt2"],
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

test("a later rewatch of an older season wins over the newer season", () => {
  const seasonTwo = series(
    "kitsu:2",
    "Frieren: Beyond Journey's End",
    1,
    7,
    400,
    1000,
    "2026-11-01T00:00:00Z",
  );
  const seasonOne = series(
    "kitsu:1",
    "Frieren: Beyond Journey's End",
    1,
    22,
    100,
    1000,
    "2026-11-09T00:00:00Z",
  );
  rememberCardCoords(seasonTwo, { season: 2, episode: 7 });
  rememberCardCoords(seasonOne, { season: 1, episode: 22 });
  const out = dedupeCwItems([seasonTwo, seasonOne], 16);
  assert.deepEqual(
    out.map((i) => [i._id, i.state?.episode]),
    [["kitsu:1", 22]],
  );
});

test("a stale older episode loses to the newer season", () => {
  const stale = series(
    "kitsu:1",
    "Frieren: Beyond Journey's End",
    1,
    9,
    400,
    1000,
    "2026-10-01T00:00:00Z",
  );
  const current = series(
    "kitsu:2",
    "Frieren: Beyond Journey's End",
    1,
    9,
    100,
    1000,
    "2026-11-01T00:00:00Z",
  );
  rememberCardCoords(stale, { season: 1, episode: 9 });
  rememberCardCoords(current, { season: 2, episode: 9 });
  const out = dedupeCwItems([stale, current], 16);
  assert.deepEqual(
    out.map((i) => i._id),
    ["kitsu:2"],
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
