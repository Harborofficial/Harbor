import assert from "node:assert/strict";
import test from "node:test";
import { MAX_GPU_PAGE_PIXELS, shouldUpscale } from "../src/lib/manga/upscale/eligibility";

test("upscales small pages the browser is stretching", () => {
  assert.equal(
    shouldUpscale({ naturalWidth: 700, naturalHeight: 1000, renderedWidth: 880, dpr: 1 }),
    true,
  );
  assert.equal(
    shouldUpscale({ naturalWidth: 700, naturalHeight: 1000, renderedWidth: 440, dpr: 2 }),
    true,
  );
});

test("leaves pages that already have enough pixels alone", () => {
  assert.equal(
    shouldUpscale({ naturalWidth: 1600, naturalHeight: 2400, renderedWidth: 880, dpr: 1 }),
    false,
  );
  assert.equal(
    shouldUpscale({ naturalWidth: 880, naturalHeight: 1200, renderedWidth: 880, dpr: 1 }),
    false,
  );
});

test("allows a double-page spread once the GPU raises the cap", () => {
  const spread = { naturalWidth: 1520, naturalHeight: 1200, renderedWidth: 880, dpr: 2.25 };
  assert.equal(shouldUpscale(spread), false);
  assert.equal(shouldUpscale({ ...spread, maxPixels: MAX_GPU_PAGE_PIXELS }), true);
});

test("allows tall webtoon strips within the GPU budget", () => {
  const strip = { naturalWidth: 720, naturalHeight: 5242, renderedWidth: 720, dpr: 2.25 };
  assert.equal(shouldUpscale(strip), false);
  assert.equal(shouldUpscale({ ...strip, maxPixels: MAX_GPU_PAGE_PIXELS }), true);
  assert.equal(
    shouldUpscale({ ...strip, naturalHeight: 12000, maxPixels: MAX_GPU_PAGE_PIXELS }),
    false,
  );
});

test("skips oversized, tiny and unlaid-out pages", () => {
  assert.equal(
    shouldUpscale({ naturalWidth: 1200, naturalHeight: 1800, renderedWidth: 1760, dpr: 1 }),
    false,
  );
  assert.equal(
    shouldUpscale({ naturalWidth: 120, naturalHeight: 180, renderedWidth: 880, dpr: 1 }),
    false,
  );
  assert.equal(
    shouldUpscale({ naturalWidth: 700, naturalHeight: 1000, renderedWidth: 0, dpr: 1 }),
    false,
  );
});
