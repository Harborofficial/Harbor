// @ts-expect-error Node test types are outside the browser tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are outside the browser tsconfig.
import test from "node:test";
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
