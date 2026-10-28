import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("the Anime4K badge only probes vo-passes while Anime4K is active and visible", () => {
  const indicator = readFileSync(
    new URL("../src/components/player/anime4k-indicator.tsx", import.meta.url),
    "utf8",
  );

  // `vo-passes` is a large node map. Polling it every two seconds for a badge
  // that is hidden anyway competes with playback on slow GPUs.
  assert.match(indicator, /settings\.playerAnime4k === true/);
  assert.match(indicator, /settings\.playerAnime4kFolder/);
  assert.match(indicator, /chromeVisible/);
  assert.match(indicator, /engine === "mpv"/);
  assert.match(indicator, /mpv_vo_passes/);
});
