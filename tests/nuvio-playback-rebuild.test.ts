import "./_localstorage-stub.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { shouldDeferPlaybackRebuild } from "../src/lib/nuvio/nuvio-sync";
import { writeCachedNuvioPlaybackItems } from "../src/lib/nuvio/nuvio-playback";

test("the playback rebuild is deferred only when no local state changed", () => {
  assert.equal(shouldDeferPlaybackRebuild(true, false, false, 0), true);
  assert.equal(shouldDeferPlaybackRebuild(false, false, false, 0), false);
  assert.equal(shouldDeferPlaybackRebuild(true, true, false, 0), false);
  assert.equal(shouldDeferPlaybackRebuild(true, false, true, 0), false);
  assert.equal(shouldDeferPlaybackRebuild(true, false, false, 1), false);
});

test("identical playback cache content does not rewrite storage", () => {
  localStorage.clear();
  let writes = 0;
  const setItem = localStorage.setItem.bind(localStorage);
  localStorage.setItem = (key: string, value: string) => {
    writes++;
    setItem(key, value);
  };

  const items = [
    {
      _id: "tt100",
      type: "series",
      name: "Fixture",
      state: { season: 1, episode: 2, timeOffset: 0 },
    },
  ] as any;

  writeCachedNuvioPlaybackItems(1, items, "acc");
  assert.equal(writes, 1);
  writeCachedNuvioPlaybackItems(1, items, "acc");
  assert.equal(writes, 1, "identical content must not rewrite the cache");

  writeCachedNuvioPlaybackItems(1, [...items, { ...items[0], _id: "tt101" }], "acc");
  assert.equal(writes, 2, "changed content must still write");
});
