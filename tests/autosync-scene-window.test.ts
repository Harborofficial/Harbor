// @ts-expect-error Node test types are intentionally outside the browser tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are intentionally outside the browser tsconfig.
import { readFileSync } from "node:fs";
// @ts-expect-error Node test types are intentionally outside the browser tsconfig.
import test from "node:test";
import { rankDialogueScenes } from "../src/lib/subtitles/autosync/scene-window.ts";

const cue = (start: number, end: number, text: string) => ({ start, end, text });
const michaelLike = [
  cue(353.84, 354.98, "Like this, alright?"),
  cue(355.5, 356.1, "Come on."),
  cue(356.3, 357.3, "But don't touch it."),
  cue(358.26, 358.62, "Alright?"),
  cue(359.28, 359.64, "Good."),
  cue(359.64, 360.64, "That's it."),
  cue(360.76, 361.44, "Keep your arms up."),
  cue(361.48, 362.48, "Keep your arms up."),
  cue(362.56, 365.68, "Look at that wall, alright?"),
  cue(366.92, 368.3, "Close your eyes."),
  cue(369.38, 370.62, "Reach out together."),
  cue(372.04, 373.16, "As one."),
  cue(375.3, 376.64, "As a family."),
  cue(378.38, 386.06, "No more Jackie, Tito, Jermaine, Marvin, and Marco."),
  cue(389.592, 395.593, "From now on, you're the Jackson Five."),
  cue(400.9, 408.9, "Corrected, translated and syncronized by; ufukbaba from Turkey"),
];

test("Michael-like sparse scene is selected from both sides of 6:16, not forward-only", () => {
  const scenes = rankDialogueScenes(michaelLike, 376.7, 3600);
  assert.ok(scenes.length > 0);
  const scene = scenes[0];
  assert.ok(scene.startSec < 376.7, "window includes dialogue behind playback");
  assert.ok(scene.dialogueCount >= 4);
  assert.equal(scene.endSec - scene.startSec, 45);
  assert.ok(scene.intervals.every(([s, e]) => s >= 0 && e <= 45 && e > s));
  assert.ok(!scene.intervals.some(([s]) => Math.abs(s + scene.startSec - 400.9) < 0.01));
});

test("credits, sound labels and duplicate lines do not bypass the four-line safety gate", () => {
  const sparse = [
    cue(376, 377, "As a family."),
    cue(378, 380, "Close your eyes."),
    cue(381, 383, "Close your eyes."),
    cue(389, 392, "Another spoken sentence."),
    cue(400, 403, "Corrected, translated and syncronized by; subtitler"),
    cue(404, 405, "[background music]"),
    cue(407, 408, "♫"),
  ];
  assert.equal(rankDialogueScenes(sparse, 376, 3600).length, 0);
});

test("buffered audio candidate must contain the exact same 45-second interval", () => {
  const scenes = rankDialogueScenes(michaelLike, 376.7, 3600, 45, [{ start: 340, end: 405 }]);
  assert.ok(scenes.length > 0);
  assert.ok(scenes.every((scene) => scene.startSec >= 340 && scene.endSec <= 405));
  const noDialogueBuffer = rankDialogueScenes(michaelLike, 376.7, 3600, 45, [
    { start: 410, end: 470 },
  ]);
  assert.equal(noDialogueBuffer.length, 0);
});

test("a narrow cached dialogue window can start between search grid points", () => {
  const start = 350.37;
  const scenes = rankDialogueScenes(michaelLike, 376.7, 3600, 45, [{ start, end: start + 45 }]);
  assert.ok(scenes.some((scene) => Math.abs(scene.startSec - start) < 0.001));
});

test("cached ranges can be assembled from adjacent contiguous segments", () => {
  const merged = rankDialogueScenes(michaelLike, 376.7, 3600, 45, [
    { start: 340, end: 365 },
    { start: 365, end: 410 },
  ]);
  assert.ok(merged.length > 0);
  const gap = rankDialogueScenes(michaelLike, 376.7, 3600, 45, [
    { start: 340, end: 365 },
    { start: 366, end: 410 },
  ]);
  assert.equal(gap.length, 0);
});

test("search stays near the playback position and does not jump across the movie", () => {
  assert.equal(rankDialogueScenes(michaelLike, 1200, 3600).length, 0);
  assert.equal(rankDialogueScenes(michaelLike, 376, 40).length, 0);
});

test("the selected audio start and cue offsets are bound to the same scene", () => {
  const scenes = rankDialogueScenes(michaelLike, 376.7, 3600);
  const scene = scenes[0];
  assert.ok(scene);
  assert.ok(
    scene.intervals.every(([start, end]) =>
      michaelLike.some((c) => {
        const absStart = start + scene.startSec;
        const absEnd = end + scene.startSec;
        return c.start <= absStart + 0.001 && c.end >= absEnd - 0.001;
      }),
    ),
  );
  const hook = readFileSync(
    new URL("../src/views/player/hooks/use-auto-sync.ts", import.meta.url),
    "utf8",
  );
  assert.match(hook, /windowStartSec: startAt/);
  assert.match(hook, /const sceneCues = scene\.intervals/);
  assert.match(hook, /const shifted = scene\.intervals/);
  assert.match(hook, /cmd: \[\s*"dump-cache",\s*startAt\.toFixed\(3\),\s*endAt\.toFixed\(3\)/);
  assert.match(
    hook,
    /const bufferedScene = rankDialogueScenes\(\s*sourceCues,\s*position,\s*duration,\s*clipSec,\s*ranges,?\s*\)/,
  );
  assert.match(hook, /const probeScenes = alternate \? \[scene, alternate\] : \[scene\]/);
  assert.match(hook, /const deadlineAt = Date\.now\(\) \+ 25_000/);
  assert.match(hook, /Math\.min\(25_000, budgetMs\)/);
});
