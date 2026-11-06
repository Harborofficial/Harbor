import assert from "node:assert/strict";
import test from "node:test";
import {
  loadOmdbSeasonsBounded,
  MAX_CONCURRENT_OMDB_SEASONS,
  selectOmdbSeasonsForOrder,
} from "../src/lib/omdb-season-queue.ts";

test("large all-episode orders only request visible seasons", () => {
  const canonical = Array.from({ length: 30 }, (_, i) => i + 1);
  assert.deepEqual(selectOmdbSeasonsForOrder(canonical, [], 20), {
    lazy: true,
    seasons: [20],
  });
  assert.deepEqual(selectOmdbSeasonsForOrder(canonical, [1, 2, 20, 2, 100], 20), {
    lazy: true,
    seasons: [20, 1, 2],
  });
  assert.deepEqual(selectOmdbSeasonsForOrder([3, 1, 2, 1], [], 2), {
    lazy: false,
    seasons: [3, 1, 2],
  });
});

test("large alternate orders keep OMDb season requests bounded and deduplicated", async () => {
  let inFlight = 0;
  let peak = 0;
  const seen: number[] = [];
  const published: number[] = [];
  await loadOmdbSeasonsBounded(
    [0, -1, 1, 1, ...Array.from({ length: 30 }, (_, i) => i + 1)],
    async (season) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      seen.push(season);
      await new Promise<void>((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
      return season * 10;
    },
    (season, result) => {
      assert.equal(result, season * 10);
      published.push(season);
    },
    () => false,
  );
  assert.equal(peak, MAX_CONCURRENT_OMDB_SEASONS);
  assert.deepEqual(
    seen.sort((a, b) => a - b),
    Array.from({ length: 30 }, (_, i) => i + 1),
  );
  assert.equal(published.length, 30);
});

test("changing views stops the queue after in-flight requests finish", async () => {
  let cancelled = false;
  let started = 0;
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const published: number[] = [];
  const run = loadOmdbSeasonsBounded(
    Array.from({ length: 30 }, (_, i) => i + 1),
    async () => {
      started++;
      await pending;
      return 8;
    },
    (season) => published.push(season),
    () => cancelled,
  );
  await Promise.resolve();
  assert.equal(started, 2);
  cancelled = true;
  release();
  await run;
  assert.equal(started, 2);
  assert.deepEqual(published, []);
});

test("a failed season does not block other seasons", async () => {
  const published: number[] = [];
  await loadOmdbSeasonsBounded(
    [1, 2, 3],
    async (season) => {
      if (season === 2) throw new Error("OMDb request failed");
      return season;
    },
    (season) => published.push(season),
    () => false,
  );
  assert.deepEqual(published.sort(), [1, 3]);
});
