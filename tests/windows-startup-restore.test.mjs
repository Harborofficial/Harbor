import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");
const placement = readFileSync(new URL("../src-tauri/src/window_placement.rs", import.meta.url), "utf8");
const fullscreen = readFileSync(new URL("../src-tauri/src/fullscreen.rs", import.meta.url), "utf8");
const browserFullscreen = readFileSync(new URL("../src/lib/fullscreen-state.ts", import.meta.url), "utf8");

test("taskbar-gap paint is restricted to the one-pixel nonclient strip", () => {
  const start = source.indexOf("unsafe fn paint_main_taskbar_gap(");
  const body = source.slice(start, source.indexOf("fn install_maximize_guard", start));
  assert.ok(start >= 0);
  assert.match(body, /!IsZoomed\(hwnd\)\.as_bool\(\)/);
  assert.match(body, /origin\.y \+ client\.bottom != work\.bottom - 1/);
  assert.match(body, /origin\.x \+ client\.right != work\.right/);
  assert.match(body, /GetWindowDC\(Some\(hwnd\)\)/);
  assert.match(body, /ReleaseDC\(Some\(hwnd\), dc\)/);
  assert.doesNotMatch(body, /SetWindowPos|set_size|set_fullscreen|SetWindowLong/);
});

test("the generic state plugin no longer restores or saves Windows main", () => {
  assert.match(source, /#\[cfg\(any\(target_os = "macos", windows\)\)\]\s*"main"/);
  assert.match(source, /"harbor-hdr-overlay"/);
  assert.match(source, /"harbor-cf-solver"/);
});

test("native placement is installed after the work-area maximize guard", () => {
  const setup = source.slice(source.indexOf(".setup(move |app|"));
  const guard = setup.indexOf("install_maximize_guard(&app.handle())");
  const placementInstall = setup.indexOf("window_placement::install(app.handle())");
  const reveal = setup.indexOf("install_reveal_failsafe(app.handle())");
  assert.ok(guard >= 0 && placementInstall > guard && reveal > placementInstall);
  assert.doesNotMatch(setup.slice(guard, reveal), /window\.restore_state\(/);
});

test("normal window state remains separate from installed and dev state", () => {
  assert.match(placement, /\.main-window-state\.dev\.json/);
  assert.match(placement, /\.main-window-state\.json/);
  assert.match(placement, /\.window-state\.json/);
  assert.match(placement, /if cfg!\(debug_assertions\) \{\s*return None/);
  assert.match(placement, /info\.rcWork/);
  assert.match(placement, /sane_dimensions/);
});

test("native mouse dragging may intentionally preserve reachable partial placement", () => {
  assert.match(source, /window_placement::mark_user_placement_complete\(\)/);
  assert.match(placement, /user_placement_pending/);
  assert.match(placement, /intentional_partial_area/);
  assert.match(placement, /reachable_partial/);
  assert.match(placement, /same_saved_partial/);
  assert.match(placement, /scale_milli/);
});

test("maximized windows track the display independently of their normal bounds", () => {
  assert.match(placement, /maximized_monitor: Option<WorkRect>/);
  assert.match(placement, /fn active_monitor_area/);
  assert.match(placement, /fn legacy_maximized_monitor/);
  assert.match(placement, /geometry\.maximized_monitor = Some\(monitor\)/);
  assert.match(placement, /fn restored_area/);
  assert.match(placement, /normal_bounds_for_maximized_target/);
  assert.match(placement, /result\.maximized_monitor = Some\(area\.rect\(\)\)/);
});

test("fullscreen and borderless transitions suppress normal geometry capture", () => {
  assert.match(fullscreen, /pause_for_transition\(main\.app_handle\(\), true\)/);
  assert.match(fullscreen, /pause_for_transition\(main\.app_handle\(\), false\)/);
  assert.match(browserFullscreen, /window_geometry_pause", \{ recordBefore: true, borderlessActive: true \}/);
  assert.match(browserFullscreen, /window_geometry_pause", \{ recordBefore: false, borderlessActive: false \}/);
});
