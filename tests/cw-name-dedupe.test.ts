// @ts-expect-error Node test types are outside the browser tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are outside the browser tsconfig.
import test from "node:test";
import { dedupeCwItems } from "../src/lib/cw-dedupe.ts";
import type { LibraryItem } from "../src/lib/stremio.ts";

const item = (id: string, name: string, type = "movie"): LibraryItem =>
  ({ _id: id, name, type }) as LibraryItem;

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
