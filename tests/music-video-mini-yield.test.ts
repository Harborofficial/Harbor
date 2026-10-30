import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const MINI = readFileSync("src/components/music/music-video-mini.tsx", "utf8");

test("starting a movie or series closes the mini and pauses the music", () => {
  assert.match(MINI, /player: media/);
  assert.match(MINI, /const mediaKey = media/);
  assert.match(MINI, /closeMusicVideoMini\(\)/);
  assert.match(MINI, /pauseMusicPlayer\(\)/);
  assert.match(MINI, /mediaKey \|\|/);
});
