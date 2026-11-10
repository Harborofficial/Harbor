import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { initialDelayForSelectedTrack } from "../src/lib/player/subtitle-delay-scope.ts";

test("embedded subtitles never inherit an external subtitle's show-level offset", () => {
  assert.equal(initialDelayForSelectedTrack({ external: false }, -3.5), 0);
  assert.equal(initialDelayForSelectedTrack({ external: false }, 2), 0);
  assert.equal(initialDelayForSelectedTrack(null, -3.5), 0);
  assert.equal(initialDelayForSelectedTrack(undefined, 5), 0);
});

test("external selected subtitles retain their intentional finite manual delay", () => {
  assert.equal(initialDelayForSelectedTrack({ external: true }, -3.5), -3.5);
  assert.equal(initialDelayForSelectedTrack({ external: true }, 0), 0);
  assert.equal(initialDelayForSelectedTrack({ external: true }, Number.NaN), 0);
  assert.equal(initialDelayForSelectedTrack({ external: true }, 9999), 0);
  assert.equal(initialDelayForSelectedTrack({ external: false }, -1.25, "embedded"), -1.25);
  assert.equal(initialDelayForSelectedTrack({ external: true }, -1.25, "embedded"), 0);
  assert.equal(initialDelayForSelectedTrack({ external: false }, -1.25, "external"), 0);
});

test("new track and Auto sync exits apply a track-specific baseline", () => {
  const autoload = readFileSync(
    new URL("../src/views/player/hooks/use-track-autoload.ts", import.meta.url),
    "utf8",
  );
  const autosync = readFileSync(
    new URL("../src/views/player/hooks/use-auto-sync.ts", import.meta.url),
    "utf8",
  );
  assert.match(autoload, /currentSubtitle\?\.id,\s*currentSubtitle\?\.external/);
  assert.match(autoload, /initialDelayForSelectedTrack\(/);
  assert.match(autosync, /initialDelayForSelectedTrack\(\s*selected,\s*baseline,/);
  assert.match(autosync, /initialDelayForSelectedTrack\(\s*selectedTrack,\s*baseline,/);
  assert.match(autosync, /bridgeRef\.current\?\.setSubDelay\(0\)/);
});
