// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import { readFileSync } from "node:fs";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import test from "node:test";

const at = (p: string) => new URL(`../${p}`, import.meta.url);
const mpv = readFileSync(at("src-tauri/src/mpv.rs"), "utf8");
const prune = readFileSync(at("src-tauri/src/temp_prune.rs"), "utf8");
const lib = readFileSync(at("src-tauri/src/lib.rs"), "utf8");
const bridge = readFileSync(at("src/lib/player/mpv.ts"), "utf8");

test("mpv keeps stream buffering in RAM instead of writing a disk cache", () => {
  assert.match(mpv, /set_property\("cache-on-disk", "no"\)/);
  assert.doesNotMatch(mpv, /cache-on-disk", "yes"/);
  assert.doesNotMatch(mpv, /set_property\("demuxer-cache-dir"/);
  assert.doesNotMatch(mpv, /full_download/);
  assert.doesNotMatch(mpv, /48GiB|100000/);
  assert.match(mpv, /demuxer-max-bytes/);
  assert.match(mpv, /demuxer-max-back-bytes/);
});

test("the player bridge no longer carries a disk cache folder or preload flag", () => {
  assert.doesNotMatch(bridge, /cacheDir/);
  assert.doesNotMatch(bridge, /fullDownload/);
});

test("leftover mpv cache files are removed at startup after a short grace", () => {
  assert.match(prune, /pub fn sweep_mpv_cache\(dir: PathBuf\) -> u64/);
  assert.match(prune, /const MPV_CACHE_RECENT_GRACE: Duration/);
  assert.doesNotMatch(prune, /MPV_CACHE_MAX_AGE/);
  assert.match(prune, /if age < MPV_CACHE_RECENT_GRACE/);
  assert.match(lib, /temp_prune::sweep_mpv_cache\(base\.join\("mpv-cache"\)\)/);
});

test("advanced mpv options cannot re-enable disk caching", () => {
  assert.match(mpv, /fn is_disk_cache_option/);
  assert.match(mpv, /extra option \{\} skipped \(disk caching is disabled\)/);
});

test("the torrent cache keeps its own cap and retention", () => {
  const defaults = readFileSync(at("src/lib/settings/defaults.ts"), "utf8");
  assert.match(defaults, /streamCacheRetentionHours: \d+/);
  assert.match(defaults, /streamCacheMaxGb: \d+/);
  const app = readFileSync(at("src/App.tsx"), "utf8");
  assert.match(app, /torrentEngineSetOptions\(/);
  assert.match(app, /settings\.streamCacheMaxGb/);
});
