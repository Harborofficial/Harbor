import assert from "node:assert/strict";
import test from "node:test";
import {
  PDF_RENDER_LIMITS,
  pageRenderSize,
  type PdfRenderLimits,
} from "../src/lib/ebook/pdf-render.ts";

function assertWithin(size: ReturnType<typeof pageRenderSize>, limits = PDF_RENDER_LIMITS) {
  assert.ok(size.width > 0);
  assert.ok(size.height > 0);
  assert.ok(size.width <= limits.maxWidth);
  assert.ok(size.height <= limits.maxHeight);
  assert.ok(size.width <= limits.maxSide);
  assert.ok(size.height <= limits.maxSide);
  assert.ok(size.width * size.height <= limits.maxPixels);
  assert.ok(size.scale <= limits.maxScale);
  assert.ok(size.scale > 0);
}

test("tall pages shrink instead of failing the minimum-scale check", () => {
  const size = pageRenderSize(690, 12_526);
  assertWithin(size);
  assert.ok(size.scale < 0.5);
  assert.ok(Math.abs(size.width / size.height - 690 / 12_526) < 0.001);
});

test("landscape pages keep their aspect ratio", () => {
  const size = pageRenderSize(2400, 1000);
  assertWithin(size);
  assert.equal(size.width, 1600);
  assert.equal(size.height, 666);
});

test("rotated page dimensions use width and height as the viewport reports them", () => {
  const portrait = pageRenderSize(595, 842);
  const rotated = pageRenderSize(842, 595);
  assertWithin(portrait);
  assertWithin(rotated);
  assert.ok(Math.abs(portrait.width / portrait.height - 595 / 842) < 0.001);
  assert.ok(Math.abs(rotated.width / rotated.height - 842 / 595) < 0.001);
});

test("oversized dimensions are bounded by the pixel budget and canvas side", () => {
  const size = pageRenderSize(20_000, 30_000);
  assertWithin(size);
  assert.ok(size.width * size.height <= PDF_RENDER_LIMITS.maxPixels);
  assert.ok(size.width <= PDF_RENDER_LIMITS.maxSide);
  assert.ok(size.height <= PDF_RENDER_LIMITS.maxSide);
});

test("custom limits are respected", () => {
  const limits: PdfRenderLimits = {
    maxWidth: 100,
    maxHeight: 100,
    maxPixels: 2_500,
    maxSide: 100,
    maxScale: 1,
  };
  const size = pageRenderSize(1000, 1000, limits);
  assertWithin(size, limits);
  assert.equal(size.width, 50);
  assert.equal(size.height, 50);
});

test("invalid page dimensions are rejected before a canvas is allocated", () => {
  for (const [width, height] of [
    [0, 100],
    [100, 0],
    [-1, 100],
    [Number.NaN, 100],
    [100, Number.POSITIVE_INFINITY],
  ] as const) {
    assert.throws(() => pageRenderSize(width, height), /invalid dimensions/);
  }
});
