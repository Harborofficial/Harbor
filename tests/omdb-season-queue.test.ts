import assert from "node:assert/strict";
import test from "node:test";
import {
  createOmdbSeasonQueue,
  MAX_CONCURRENT_OMDB_SEASONS,
  selectOmdbSeasonsForOrder,
} from "../src/lib/omdb-season-queue.ts";

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

test("large all-episode orders initially request only a preferred season", () => {
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

test(
  "progressively revealed seasons are deduplicated and never exceed two requests",
  { timeout: 5000 },
  async () => {
    let inFlight = 0;
    let peak = 0;
    const seen: number[] = [];
    const published: number[] = [];
    let finished!: () => void;
    const done = new Promise<void>((resolve) => {
      finished = resolve;
    });
    const queue = createOmdbSeasonQueue(
      async (season: number) => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        seen.push(season);
        await new Promise<void>((resolve) => setTimeout(resolve, 2));
        inFlight--;
        return season * 10;
      },
      (season, result) => {
        assert.equal(result, season * 10);
        published.push(season);
        if (published.length === 10) finished();
      },
    );
    queue.enqueue([0, -1, 1, 1, 2, 3]);
    queue.enqueue([1, 2, 3, 4, 5]);
    queue.enqueue([5, 4, 6, 7, 8, 9, 10]);
    await done;
    assert.equal(peak, MAX_CONCURRENT_OMDB_SEASONS);
    assert.deepEqual(
      seen.sort((a, b) => a - b),
      Array.from({ length: 10 }, (_, i) => i + 1),
    );
    assert.equal(published.length, 10);
    queue.dispose();
  },
);

test("a missing season is only attempted once during subsequent visibility updates", async () => {
  const requested: number[] = [];
  const queue = createOmdbSeasonQueue(
    async (season: number) => {
      requested.push(season);
      return new Map<number, number>(); // OMDb may return no data for a season.
    },
    () => {},
  );
  queue.enqueue([1]);
  await settle();
  queue.enqueue([1, 2]);
  await settle();
  queue.enqueue([1, 2, 3]);
  await settle();
  queue.enqueue([1, 2, 3, 4]);
  await settle();
  assert.deepEqual(requested, [1, 2, 3, 4]);
  queue.dispose();
});

test("disposing stops pending work and ignores in-flight results", async () => {
  const started: number[] = [];
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const published: number[] = [];
  const queue = createOmdbSeasonQueue(
    async (season: number) => {
      started.push(season);
      await pending;
      return season;
    },
    (season) => published.push(season),
  );
  queue.enqueue(Array.from({ length: 30 }, (_, i) => i + 1));
  assert.deepEqual(started, [1, 2]);
  queue.dispose();
  queue.enqueue([31]);
  release();
  await settle();
  assert.deepEqual(started, [1, 2]);
  assert.deepEqual(published, []);
});

test("a failed season does not block subsequent seasons", async () => {
  const published: number[] = [];
  const queue = createOmdbSeasonQueue(
    async (season: number) => {
      if (season === 2) throw new Error("OMDb unavailable");
      return season;
    },
    (season) => published.push(season),
  );
  queue.enqueue([1, 2, 3]);
  await settle();
  assert.deepEqual(published.sort(), [1, 3]);
  queue.dispose();
});
