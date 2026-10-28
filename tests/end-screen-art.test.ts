import assert from "node:assert/strict";
import test from "node:test";
import { endScreenArt, warmEndScreenArt } from "../src/lib/player/end-screen-art.ts";

test("art warmup deduplicates URLs and waits for decoding, tolerating broken images", async () => {
  const original = globalThis.Image;
  const images: any[] = [];
  let decoded = 0;
  globalThis.Image = class {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    decoding = "";
    src = "";
    constructor() {
      images.push(this);
    }
    async decode() {
      decoded++;
    }
  } as any;
  try {
    const pending = warmEndScreenArt(["good", "good", undefined, "broken"]);
    assert.equal(images.length, 2);
    images[0].onload();
    images[1].onerror();
    await pending;
    assert.equal(decoded, 1);
  } finally {
    globalThis.Image = original;
  }
});

test("preload and renderer request the same high-resolution artwork", () => {
  assert.equal(
    endScreenArt("https://image.tmdb.org/t/p/w780/art.jpg"),
    "https://image.tmdb.org/t/p/original/art.jpg",
  );
  assert.equal(endScreenArt(undefined), undefined);
});
