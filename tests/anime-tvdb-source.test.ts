import assert from "node:assert/strict";
import test from "node:test";
import { isSharedSplitTvdb } from "../src/lib/providers/anime-tvdb-source.ts";

test("a split cour resolving to the base show's TVDB id is rejected", () => {
  assert.equal(isSharedSplitTvdb(49444, 74796, 74796), true);
  assert.equal(isSharedSplitTvdb(49444, 424536, 74796), false);
});

test("a normal entry sharing an id with its own root is not rejected", () => {
  assert.equal(isSharedSplitTvdb(12, 74796, 74796), false);
});
