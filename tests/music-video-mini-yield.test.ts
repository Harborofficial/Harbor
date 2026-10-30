import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const MINI = readFileSync("src/components/music/music-video-mini.tsx", "utf8");

test("starting a movie or series hides and pauses the mini without closing it for good", () => {
  assert.match(MINI, /player: media/);
  assert.match(MINI, /const mediaKey = media/);
  assert.match(MINI, /pauseMusicPlayer\(\)/);
  assert.match(MINI, /mediaKey \|\|/);
  assert.doesNotMatch(MINI, /if \(mediaKey\) closeMusicVideoMini\(\)/);
  assert.doesNotMatch(MINI, /if \(!mediaKey\) return;\s*\n\s*closeMusicVideoMini\(\)/);
});
