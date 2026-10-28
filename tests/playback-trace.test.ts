// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import { readFileSync } from "node:fs";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import test from "node:test";

const at = (p: string) => new URL(`../${p}`, import.meta.url);
const read = (p: string) => readFileSync(at(p), "utf8");

// A release build's only log is mpv's, and a bare `Set property: pause` line
// cannot say which control asked for the change. These assertions keep the
// caller tags wired to the paths that can pause without a click.

test("mpv allows print-text so a release log can name the pause caller", () => {
  assert.match(read("src-tauri/src/mpv.rs"), /"print-text",/);
});

test("the mpv bridge tags every play and pause with its caller", () => {
  const mpv = read("src/lib/player/mpv.ts");
  assert.match(mpv, /tracePlayback\(`play source=\$\{options\?\.reason \?\? "unspecified"\}`\)/);
  assert.match(
    mpv,
    /pause\(reason = "unspecified"\) \{\s*tracePlayback\(`pause source=\$\{reason\}`\)/,
  );
  // The trace must run before the property write, or a log line without a
  // matching pause would be misread as a separate event.
  assert.match(
    mpv,
    /pause\(reason = "unspecified"\) \{\s*tracePlayback\(`pause source=\$\{reason\}`\);\s*traceFrameDrops\(reason\);\s*invoke\("mpv_set_property", \{ name: "pause", value: true \}\)/,
  );
});

test("a freeze is classified as a hold or a dropped-frame event", () => {
  const trace = read("src/lib/player/pause-trace.ts");
  // A freeze that resumes where it stopped is a hold; one that jumps forward
  // dropped frames. Both counters go into the same log line.
  assert.match(trace, /"frame-drop-count"/);
  assert.match(trace, /"decoder-frame-drop-count"/);
  const mpv = read("src/lib/player/mpv.ts");
  assert.match(mpv, /traceFrameDrops\(reason\);/);
  assert.match(mpv, /if \(name === "eof-reached" && data === true\) \{[\s\S]*?traceFrameDrops\("eof"\)/);
});

test("a collapsed video surface is recorded once per transition", () => {
  const mpv = read("src/lib/player/mpv.ts");
  assert.match(mpv, /const collapsed = r\.cssWidth < 64 \|\| r\.cssHeight < 64;/);
  assert.match(mpv, /if \(collapsed !== lastCollapsed\)/);
  assert.match(mpv, /`geom \$\{Math\.round\(r\.cssWidth\)\}x\$\{Math\.round\(r\.cssHeight\)\} collapsed=\$\{collapsed\}`/);
});

test("paths that can pause without a click name themselves", () => {
  assert.match(
    read("src/views/player/hooks/use-pause-on-inactive.ts"),
    /bridge\.pause\(`inactive focused=false minimized=\$\{minimized\}`\)/,
  );
  const keys = read("src/views/player/hooks/use-keyboard-shortcuts.ts");
  assert.match(keys, /tracePlayback\(`media-key \$\{e\.payload\} status=\$\{m\.status\}`\)/);
  assert.match(keys, /tracePlayback\(`media-key-dom \$\{e\.key\}`\)/);
  assert.match(read("src/views/player/hooks/use-sleep-timer.ts"), /pause\("sleep-timer"\)/);
  assert.match(
    read("src/views/video-pip.tsx"),
    /tracePlayback\(`\$\{next \? "pause" : "play"\} source=video-pip`\)/,
  );
});

test("the tray emits only the preference it toggled", () => {
  const tray = read("src-tauri/src/tray.rs");
  const toggle = tray.slice(tray.indexOf("fn toggle("), tray.indexOf("#[tauri::command]"));
  // Echoing the whole set let a stale Rust default overwrite a setting the
  // user had switched off in the app.
  assert.doesNotMatch(toggle, /current_prefs\(\)/);
  for (const key of ["closeToTray", "alwaysOnTop", "pauseMinimized", "pauseUnfocused"]) {
    assert.match(toggle, new RegExp(`"${key}": next`));
  }
});

test("the frontend keeps settings the tray did not send", () => {
  const settings = read("src/lib/settings.tsx");
  assert.match(settings, /pauseMinimized: p\.pauseMinimized \?\? s\.pauseMinimized/);
  assert.match(settings, /pauseUnfocused: p\.pauseUnfocused \?\? s\.pauseUnfocused/);
  assert.match(settings, /trayAlwaysOnTop: p\.alwaysOnTop \?\? s\.trayAlwaysOnTop/);
});
