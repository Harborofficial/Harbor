// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import test from "node:test";
import { isPlayableVideoPath, stripPlayableVideoExtension } from "../src/lib/media-file";

test("rare mpv containers are accepted as video files", () => {
  for (const name of ["VIDEO_TS/VTS_01_1.VOB", "film.rmvb", "clip.mxf", "disc.iso", "tape.dv"]) {
    assert.equal(isPlayableVideoPath(name), true, name);
  }
  assert.equal(isPlayableVideoPath("subtitles.srt"), false);
  assert.equal(isPlayableVideoPath("video.vob.txt"), false);
});

test("a video URL with a query retains its file extension", () => {
  assert.equal(isPlayableVideoPath("https://example.org/video.vob?token=abc"), true);
  assert.equal(stripPlayableVideoExtension("episode.vob"), "episode");
});
