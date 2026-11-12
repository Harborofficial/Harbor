// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import test from "node:test";
import { anyTabLocked, DEFAULT_HIDDEN, type HiddenTabs } from "../src/lib/lockable-tabs.ts";

test("a saved restriction for a tab that no longer exists does not lock a profile", () => {
  const savedTabs = { ...DEFAULT_HIDDEN, removedTab: true } as unknown as HiddenTabs;
  assert.equal(anyTabLocked(savedTabs), false);
});

test("current tab restrictions still lock a profile with legacy Sports preferences", () => {
  const savedTabs = { ...DEFAULT_HIDDEN, sports: true, movies: true };
  assert.equal(anyTabLocked(savedTabs), true);
});
