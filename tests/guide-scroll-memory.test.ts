import assert from "node:assert/strict";
import test from "node:test";
import { PX_PER_MS, WINDOW_PX } from "../src/views/live/guide/guide-utils.ts";
import {
  guideScrollLeftFor,
  guideScrollTime,
  recallGuideScroll,
  rememberGuideScroll,
} from "../src/views/live/guide/guide-scroll-memory.ts";

const WINDOW_START = 1_700_000_000_000;
const VIEWPORT = 1600;

test("remembers the guide time and channel position per source", () => {
  rememberGuideScroll("pl-a", { atMs: WINDOW_START + 120_000, top: 440 });
  rememberGuideScroll("pl-b", { atMs: WINDOW_START + 60_000, top: 0 });

  assert.deepEqual(recallGuideScroll("pl-a"), { atMs: WINDOW_START + 120_000, top: 440 });
  assert.deepEqual(recallGuideScroll("pl-b"), { atMs: WINDOW_START + 60_000, top: 0 });
  assert.equal(recallGuideScroll("missing"), null);
});

test("maps a saved time back to the same horizontal offset", () => {
  const left = 240;
  const atMs = guideScrollTime(WINDOW_START, left);
  assert.equal(guideScrollLeftFor({ atMs, top: 0 }, WINDOW_START, VIEWPORT), left);
});

test("falls back when the saved time is outside the guide window", () => {
  assert.equal(
    guideScrollLeftFor({ atMs: WINDOW_START - 1, top: 0 }, WINDOW_START, VIEWPORT),
    null,
  );
  assert.equal(
    guideScrollLeftFor(
      { atMs: WINDOW_START + WINDOW_PX / PX_PER_MS, top: 0 },
      WINDOW_START,
      VIEWPORT,
    ),
    null,
  );
});

test("a saved position at the end of the window is still restorable", () => {
  const left = WINDOW_PX - VIEWPORT;
  const atMs = guideScrollTime(WINDOW_START, left);
  assert.equal(guideScrollLeftFor({ atMs, top: 0 }, WINDOW_START, VIEWPORT), left);
});

test("keeps the newest sources without growing without bound", () => {
  for (let i = 0; i < 40; i++) rememberGuideScroll(`pl-${i}`, { atMs: WINDOW_START + i, top: i });
  assert.ok(recallGuideScroll("pl-0") === null, "oldest entry should be evicted");
  assert.deepEqual(recallGuideScroll("pl-39"), { atMs: WINDOW_START + 39, top: 39 });
});
