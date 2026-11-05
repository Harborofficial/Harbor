import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (file: string) =>
  readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("subtitle sync dropdown puts Sync from playback between Auto sync and Manual offset", () => {
  const control = read("src/components/player/subtitle-menu/sync-control.tsx");
  const auto = control.indexOf('name="auto-sync"');
  const playback = control.indexOf('tr("Sync from playback")');
  const manual = control.indexOf('tr("Manual offset")');
  assert.ok(auto >= 0 && playback > auto && manual > playback);
  assert.match(control, /autoSync\.listen\(\)/);
  assert.match(control, /\{tr\("Sync from playback"\)\}<\/span>/);
  assert.doesNotMatch(control, /\{tr\("AI"\)\}/);
  assert.match(control, /disabled=\{!canSyncFromPlayback \|\| busy \|\| !autoSync\}/);
});

test("Sync from playback appears only for an embedded-mpv player with external subtitles selected", () => {
  const header = read("src/components/player/subtitle-menu/menu-header.tsx");
  assert.match(header, /canSyncFromPlayback=\{p\.engine === "mpv" && p\.selectedTrack\?\.external === true\}/);
});

test("the existing Sync from playback fallback after unsuccessful dialogue matching is unchanged", () => {
  const popover = read("src/components/player/autosync/autosync-popover.tsx");
  const hook = read("src/views/player/hooks/use-auto-sync.ts");
  assert.match(popover, /label=\{t\("Sync from playback"\)\} onClick=\{props\.onListen\}/);
  assert.match(hook, /listen: \(\) => listen\(true\)/);
  assert.match(hook, /fallback=playback-cache/);
});
