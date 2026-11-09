// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import { readFileSync } from "node:fs";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import test from "node:test";

const at = (p: string) => new URL(`../${p}`, import.meta.url);
const mpvRs = readFileSync(at("src-tauri/src/mpv.rs"), "utf8");

const setProperty = mpvRs.slice(
  mpvRs.indexOf("pub async fn mpv_set_property("),
  mpvRs.indexOf("pub async fn mpv_get_property("),
);
const resync = mpvRs.slice(
  mpvRs.indexOf("fn resync_audio_after_switch("),
  mpvRs.indexOf("pub async fn mpv_get_property("),
);

// Switching to a track with a large demuxer readahead makes mpv delay the new
// audio until the cache drains (mpv-player/mpv#18371): silence for minutes,
// cleared only by the same-position seek a viewer performs by hand.
test("a changed audio track is followed by a same-position exact seek", () => {
  assert.match(setProperty, /name == "aid"/);
  assert.match(setProperty, /str_val != "no"/);
  assert.match(setProperty, /!is_live/);
  // Re-writing the track mpv already holds must not force another seek.
  assert.match(
    setProperty,
    /get_property::<String>\("aid"\)[\s\S]*?!= Some\(str_val\.as_str\(\)\)/,
  );
  const set = setProperty.indexOf("mpv.set_property(&name, str_val.as_str())");
  assert.ok(set >= 0 && setProperty.indexOf("resync_audio_after_switch(&mpv)") > set);
});

test("the resync seeks to the current position only during playback", () => {
  assert.match(resync, /get_property::<f64>\("time-pos"\)/);
  assert.match(resync, /pos <= 0\.0/);
  assert.match(resync, /\["seek", &pos, "absolute\+exact"\]/);
});

test("every audio track surface goes through mpv_set_property", () => {
  for (const file of [
    "src/lib/player/mpv.ts",
    "src/lib/player/mpv-forward.ts",
    "src/views/video-pip-settings.tsx",
  ]) {
    assert.match(readFileSync(at(file), "utf8"), /mpv_set_property[\s\S]*?"aid"/, file);
  }
});
