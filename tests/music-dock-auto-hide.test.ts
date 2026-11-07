import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  musicDockCanAutoHide,
  MUSIC_DOCK_AUTO_HIDE_MS,
  MUSIC_DOCK_REVEAL_ZONE_PX,
} from "../src/lib/music/dock-auto-hide.ts";

const read = (path: string) =>
  readFileSync(new URL("../" + path, import.meta.url), "utf8");

const base = {
  enabled: true,
  visible: true,
  collapsed: false,
  expanded: false,
  queueOpen: false,
  sourceOpen: false,
  dragging: false,
  closing: false,
  error: false,
};

test("dock auto-hide is opt-in and the preference remains off by default", () => {
  const state = read("src/lib/music/dock-auto-hide.ts");
  const settings = read("src/components/music/music-dock-parts.tsx");
  assert.match(state, /autoHideEnabled = readMusicPreference\(PREFERENCE_KEY\) === "true"/);
  assert.match(state, /writeMusicPreference\(PREFERENCE_KEY, String\(enabled\)\)/);
  assert.match(settings, /checked=\{autoHide\}/);
  assert.match(settings, /setMusicDockAutoHide\(event\.target\.checked\)/);
  assert.equal(musicDockCanAutoHide({ ...base, enabled: false }), false);
});

test("2-second hide requires an idle dock; interaction, errors and overlays keep it visible", () => {
  assert.equal(MUSIC_DOCK_AUTO_HIDE_MS, 2000);
  assert.equal(musicDockCanAutoHide(base), true);
  for (const field of ["collapsed", "expanded", "queueOpen", "sourceOpen", "dragging", "closing", "error"] as const) {
    assert.equal(musicDockCanAutoHide({ ...base, [field]: true }), false, field);
  }
  assert.equal(musicDockCanAutoHide({ ...base, visible: false }), false);
});

test("the slide-away dock can be revealed from the bottom edge and honors reduced motion", () => {
  const dock = read("src/components/music/music-dock.tsx");
  const styles = read("src/components/music/music-dock.css");
  assert.equal(MUSIC_DOCK_REVEAL_ZONE_PX, 28);
  assert.match(dock, /data-music-dock-reveal/);
  assert.match(dock, /onPointerEnter=\{showAutoHiddenDock\}/);
  assert.match(dock, /data-auto-hidden=\{autoHidden \|\| undefined\}/);
  assert.match(dock, /const autoHideEnabled = useMusicDockAutoHide\(\)/);
  assert.match(styles, /\.music-dock-auto-hide\[data-auto-hidden\]/);
  assert.match(styles, /transition: transform 350ms/);
  assert.match(styles, /prefers-reduced-motion: reduce/);
});
