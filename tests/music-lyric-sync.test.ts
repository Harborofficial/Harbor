import test from "node:test";
import assert from "node:assert/strict";
import {
  addLyricSyncPoint,
  applyLyricSync,
  getLyricSync,
  setLyricSync,
  subscribeLyricSync,
} from "../src/lib/music/lyric-sync";
import type { MusicTrack } from "../src/lib/music/types";
import type { LyricLine } from "../src/lib/music/lyrics";

const LINES: LyricLine[] = [
  { at: 10, text: "one" },
  { at: 60, text: "two" },
  { at: 120, text: "three" },
];

test("one alignment shifts every section, not only the line that was tapped", () => {
  const shifted = applyLyricSync(LINES, [{ t: 10, at: 12 }]);
  assert.deepEqual(
    shifted.map((line) => line.at),
    [12, 62, 122],
  );
  assert.deepEqual(
    shifted.map((line) => line.text),
    ["one", "two", "three"],
  );
});

test("a second alignment corrects drift across the whole song", () => {
  const shifted = applyLyricSync(LINES, [
    { t: 10, at: 12 },
    { t: 110, at: 114 },
  ]);
  assert.deepEqual(
    shifted.map((line) => line.at),
    [12, 63, 124.2],
  );
});

test("no alignments leave the timestamps untouched", () => {
  assert.equal(applyLyricSync(LINES, []), LINES);
});

test("a repeat alignment on the same line replaces it instead of faking drift", () => {
  const once = addLyricSyncPoint([], { t: 10, at: 11 });
  assert.deepEqual(once, [{ t: 10, at: 11 }]);
  const again = addLyricSyncPoint(once, { t: 10, at: 12 });
  assert.deepEqual(again, [{ t: 10, at: 12 }]);
  const two = addLyricSyncPoint(again, { t: 20, at: 21 });
  assert.deepEqual(two, [
    { t: 10, at: 12 },
    { t: 20, at: 21 },
  ]);
  const three = addLyricSyncPoint(two, { t: 30, at: 32 });
  assert.deepEqual(three, [
    { t: 10, at: 12 },
    { t: 30, at: 32 },
  ]);
});

test("alignments are stored per track and notify every lyric view", () => {
  const track = {
    id: "t-sync",
    connectorId: "local",
    title: "Song",
    artist: "Artist",
    artwork: "",
    durationSeconds: 120,
    durationLabel: "2:00",
  } satisfies MusicTrack;
  let heard = 0;
  const stop = subscribeLyricSync(() => {
    heard += 1;
  });
  assert.deepEqual(setLyricSync(track, [{ t: 10, at: 11 }]), [{ t: 10, at: 11 }]);
  assert.deepEqual(getLyricSync(track), [{ t: 10, at: 11 }]);
  assert.equal(heard, 1);
  stop();
  setLyricSync(track, []);
  assert.deepEqual(getLyricSync(track), []);
  assert.equal(heard, 1);
});
