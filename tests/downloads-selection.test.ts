// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import test from "node:test";
import {
  selectedVisibleIds, toggleDownloadGroupSelection, toggleDownloadSelection,
} from "../src/views/downloads/selection.ts";

test("selecting movie or episode rows toggles only those downloads", () => {
  const first = toggleDownloadSelection(new Set<string>(), "movie-1");
  assert.deepEqual([...first], ["movie-1"]);
  assert.equal(first.has("episode-1"), false);
  assert.deepEqual([...toggleDownloadSelection(first, "movie-1")], []);
});

test("selecting a show toggles all visible episodes, with partial group state", () => {
  const partial = toggleDownloadSelection(new Set<string>(), "e1");
  const selected = toggleDownloadGroupSelection(partial, ["e1", "e2", "e3"]);
  assert.deepEqual([...selected].sort(), ["e1", "e2", "e3"]);
  const clear = toggleDownloadGroupSelection(selected, ["e1", "e2", "e3"]);
  assert.equal(clear.size, 0);
});

test("selecting one show preserves downloads selected outside that show", () => {
  const selected = toggleDownloadGroupSelection(new Set(["other"]), ["s1", "s2"]);
  assert.deepEqual([...selected], ["other", "s1", "s2"]);
  assert.deepEqual([...toggleDownloadGroupSelection(selected, ["s1", "s2"])], ["other"]);
});

test("batch actions only receive selected IDs visible in the current filter", () => {
  const selected = new Set(["canceled-1", "done-1", "other"]);
  assert.deepEqual(selectedVisibleIds(["done-1", "done-2"], selected), ["done-1"]);
  assert.deepEqual(selectedVisibleIds(["canceled-1"], selected), ["canceled-1"]);
});
