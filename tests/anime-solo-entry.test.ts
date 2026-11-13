import assert from "node:assert/strict";
import test from "node:test";
import { isSoloSplitEntry } from "../src/views/detail/anime-episodes/solo-entry.ts";

test("a TYBW cour is solo before its franchise root resolves", () => {
  assert.equal(isSoloSplitEntry("kitsu:49444", null), true);
  assert.equal(isSoloSplitEntry("kitsu:49444", "kitsu:244"), true);
});

test("the base Bleach entry is not solo", () => {
  assert.equal(isSoloSplitEntry("kitsu:244", "kitsu:244"), false);
  assert.equal(isSoloSplitEntry("kitsu:244", null), false);
});

test("an ordinary anime entry is not solo", () => {
  assert.equal(isSoloSplitEntry("kitsu:12", "kitsu:12"), false);
});
