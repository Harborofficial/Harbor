// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import test from "node:test";
import "./_localstorage-stub.ts";
import { activeProfileId } from "../src/lib/active-profile-id.ts";
import {
  emptyCache,
  indexItem,
  resetForProfile,
  type SimklCacheItem,
} from "../src/lib/simkl/activities/store.ts";
import { simklAnimeArtworkIds } from "../src/lib/simkl/anime-artwork-ids.ts";

Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: {},
});

test("Simkl anime artwork ids resolve from the synced activity cache", async () => {
  resetForProfile();
  localStorage.clear();
  const item: SimklCacheItem = {
    simklId: 424242,
    type: "anime",
    title: "Test Anime",
    year: 2020,
    status: "watching",
    userRating: null,
    watchedAt: null,
  };
  const cache = emptyCache();
  cache.items[String(item.simklId)] = item;
  indexItem(cache, item, { kitsu: 12, mal: 21, imdb: "tt1234567", tmdb: 7 });
  localStorage.setItem(`harbor.simkl.cache.v2.${activeProfileId()}`, JSON.stringify(cache));
  resetForProfile();

  assert.deepEqual(await simklAnimeArtworkIds(item.simklId), {
    kitsu: 12,
    mal: 21,
    imdb: "tt1234567",
    tmdb: 7,
  });

  resetForProfile();
  localStorage.clear();
});
