// @ts-expect-error Node tests intentionally run outside the browser TS config.
import assert from "node:assert/strict";
// @ts-expect-error Node tests intentionally run outside the browser TS config.
import { readFileSync } from "node:fs";
// @ts-expect-error Node tests intentionally run outside the browser TS config.
import test from "node:test";
import { isAutoSyncScopeCurrent } from "../src/lib/player/subtitle-fps.ts";
import {
  autoSyncExitBaseline,
  isOwnGeneratedSyncTrack,
} from "../src/lib/subtitles/autosync/active-scope.ts";

const scope = { mediaKey: "show:S1E1:source-A", trackId: "5", audioKey: "a1" };
const ownedPath = "C:\\temp\\harbor-subs\\autosync-123.srt";

const original = { id: "5", title: "English SRT", external: true };
const embedded = { id: "1", title: "English embedded", external: false };
const anotherExternal = { id: "8", title: "English SRT", external: true };
const ownGenerated = {
  id: "6",
  title: "Synced (SRT)",
  external: true,
  externalFilename: "C:/temp/harbor-subs/autosync-123.srt",
};
const otherGenerated = {
  id: "9",
  title: "Synced (SRT)",
  external: true,
  externalFilename: "C:/temp/harbor-subs/autosync-OTHER.srt",
};

function activeFor(
  track: typeof original | typeof embedded | typeof ownGenerated | typeof otherGenerated,
  mediaKey = scope.mediaKey,
  audioKey = scope.audioKey,
) {
  return isAutoSyncScopeCurrent(scope, {
    mediaKey,
    audioKey,
    trackId: track.id,
    syncedTrack: isOwnGeneratedSyncTrack(track, ownedPath),
  });
}

test("a delay correction survives on its original external subtitle", () => {
  assert.equal(activeFor(original), true);
});

test("changing to an embedded subtitle discards the active Auto sync scope", () => {
  assert.equal(isOwnGeneratedSyncTrack(embedded, ownedPath), false);
  assert.equal(activeFor(embedded), false);
  assert.equal(autoSyncExitBaseline(scope.mediaKey, scope.mediaKey, 1.2, 42), 1.2);
});

test("another external subtitle does not inherit the automatic offset", () => {
  assert.equal(activeFor(anotherExternal), false);
});

test("only the generated file owned by this run can carry its corrected timing", () => {
  assert.equal(isOwnGeneratedSyncTrack(ownGenerated, ownedPath), true);
  assert.equal(activeFor(ownGenerated), true);
  assert.equal(isOwnGeneratedSyncTrack(otherGenerated, ownedPath), false);
  assert.equal(activeFor(otherGenerated), false);
});

test("different playback source or episode resets the offset to its own baseline", () => {
  assert.equal(activeFor(original, "show:S1E1:source-B"), false);
  assert.equal(activeFor(original, "show:S1E2:source-A"), false);
  assert.equal(autoSyncExitBaseline(scope.mediaKey, "show:S1E2:source-A", 3.866, 0), 0);
});

test("changing the selected audio invalidates Auto sync correction", () => {
  assert.equal(activeFor(original, scope.mediaKey, "a2"), false);
});

test("an embedded-selected playback offers external subtitle selection instead of disabling Auto sync", () => {
  const menu = readFileSync(
    new URL("../src/components/player/subtitle-menu/menu-header.tsx", import.meta.url),
    "utf8",
  );
  const control = readFileSync(
    new URL("../src/components/player/subtitle-menu/sync-control.tsx", import.meta.url),
    "utf8",
  );
  const body = readFileSync(
    new URL("../src/components/player/subtitle-menu/menu-body.tsx", import.meta.url),
    "utf8",
  );
  assert.match(menu, /canChooseExternal = p\.engine === "mpv" && !canAutoSync/);
  assert.match(control, /disabled=\{!canAutoSync && !canChooseExternal\}/);
  assert.match(control, /if \(canChooseExternal\) onChooseExternal\(\)/);
  assert.match(body, /setSourceFilter\("external"\)/);
  assert.match(body, /setSearchOpen\(true\)/);
});

test("a reused mpv session resets inherited subtitle delay before loadfile", () => {
  const mpv = readFileSync(new URL("../src/lib/player/mpv.ts", import.meta.url), "utf8");
  const stop = mpv.indexOf('await invoke("mpv_command", { cmd: ["stop"] })');
  const reset = mpv.indexOf('invoke("mpv_set_property", { name: "sub-delay", value: 0 })', stop);
  const loadfile = mpv.indexOf('"loadfile",', stop);
  assert.ok(stop >= 0 && reset > stop && loadfile > reset);
  assert.match(mpv, /snap\.subDelaySec = 0;/);
});

test("the hook cleans the live mpv delay before restoring on another track", () => {
  const hook = readFileSync(
    new URL("../src/views/player/hooks/use-auto-sync.ts", import.meta.url),
    "utf8",
  );
  const cleanup = hook.indexOf("A native mpv sub-delay affects every subtitle");
  const restoration = hook.indexOf("Restore confirmed corrections before");
  assert.ok(cleanup >= 0 && restoration > cleanup);
  assert.match(
    hook.slice(cleanup, restoration),
    /bridgeRef\.current\?\.setSubDelay\(\s*initialDelayForSelectedTrack\(\s*selected,\s*baseline,/,
  );
  assert.match(hook, /a\.generatedTrackPath = path/);
  assert.match(hook, /if \(!hasActiveCorrection\) statusScopeRef\.current = null/);
  assert.match(hook, /readPlayerPrefs\(src\.meta\.id\)\?\.subDelaySec \?\? 0/);
});
