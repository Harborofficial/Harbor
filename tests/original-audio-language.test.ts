// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import test from "node:test";
import { audioLanguageOrder } from "../src/lib/player/original-audio-language";

test("original language is placed ahead of ordinary audio preferences", () => {
  assert.deepEqual(audioLanguageOrder(["English", "French"], "ko"), ["ko", "en", "fr"]);
});

test("a remembered per-show choice remains first and languages are deduplicated", () => {
  assert.deepEqual(audioLanguageOrder(["English", "Japanese"], "ja", "English"), ["en", "ja"]);
});
