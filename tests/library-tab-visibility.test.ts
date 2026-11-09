// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import test from "node:test";
import {
  hiddenLibraryTabs,
  isLibraryTabShown,
  toggleHiddenLibraryTab,
} from "../src/views/library/tab-visibility.ts";

test("stored hidden tabs ignore malformed values and the Library tab", () => {
  assert.deepEqual([...hiddenLibraryTabs(undefined)], []);
  assert.deepEqual([...hiddenLibraryTabs("torbox")], []);
  assert.deepEqual([...hiddenLibraryTabs(["torbox", "library", "nope", 4, null])], ["torbox"]);
});

test("a hidden tab stays reachable while it is the open tab", () => {
  const hidden = hiddenLibraryTabs(["torbox", "groups"]);
  assert.equal(isLibraryTabShown("torbox", hidden, "library"), false);
  assert.equal(isLibraryTabShown("groups", hidden, "groups"), true);
  assert.equal(isLibraryTabShown("history", hidden, "library"), true);
});

test("toggling hides and restores a tab in a stable order", () => {
  const hidden = hiddenLibraryTabs(["torbox"]);
  assert.deepEqual(toggleHiddenLibraryTab(hidden, "history"), ["history", "torbox"]);
  assert.deepEqual(toggleHiddenLibraryTab(hidden, "torbox"), []);
});

test("the Library tab cannot be hidden", () => {
  assert.deepEqual(toggleHiddenLibraryTab(hiddenLibraryTabs([]), "library"), []);
});
