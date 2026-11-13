// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import test from "node:test";
import { HOTKEYS, findHotkeyMatch } from "../src/lib/hotkeys.ts";
import { playerShortcutGroups } from "../src/lib/player/shortcut-groups.ts";
import {
  SUB_FONT_SIZE_MAX,
  SUB_FONT_SIZE_MIN,
  nextAudioTrack,
  stepSubFontSize,
  trackDisplayName,
} from "../src/lib/player/track-cycle.ts";
import type { TrackInfo } from "../src/lib/player/bridge.ts";

function keyboardEvent(key: string, init: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    key,
    code: "",
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    isComposing: false,
    target: null,
    ...init,
  } as KeyboardEvent;
}

const audio = (id: string, selected = false, extra: Partial<TrackInfo> = {}): TrackInfo => ({
  id,
  label: `Track ${id}`,
  kind: "audio",
  selected,
  ...extra,
});

test("the shortcuts list covers every player hotkey and nothing else", () => {
  const listed = playerShortcutGroups({}).flatMap((group) => group.items.map((item) => item.id));
  const expected = HOTKEYS.filter((def) => def.scope === "Player").map((def) => def.id);
  assert.deepEqual([...listed].sort(), [...expected].sort());
  assert.equal(listed.includes("globalSearchFocus"), false);
  assert.equal(listed.includes("mangaMatch"), false);
});

test("the shortcuts list shows the user's own bindings", () => {
  const groups = playerShortcutGroups({ playerMute: "q" });
  const items = groups.flatMap((group) => group.items);
  assert.equal(items.find((item) => item.id === "playerMute")?.binding, "q");
  assert.equal(items.find((item) => item.id === "playerFullscreen")?.binding, "f");
});

test("new player hotkeys do not collide with existing default bindings", () => {
  const added = ["playerShortcuts", "playerAudioCycle", "playerSubSizeDown", "playerSubSizeUp"];
  for (const id of added) {
    const def = HOTKEYS.find((entry) => entry.id === id);
    assert.ok(def, id);
    const clashes = HOTKEYS.filter(
      (entry) =>
        entry.id !== id &&
        entry.defaultBinding === def.defaultBinding &&
        (entry.scope === def.scope || entry.scope === "Global"),
    );
    assert.deepEqual(clashes, [], id);
  }
});

test("Shift+? opens the shortcuts list and leaves search focus alone", () => {
  const event = keyboardEvent("?", { shiftKey: true, code: "Slash" });
  assert.equal(findHotkeyMatch(event, {}, "Player"), "playerShortcuts");
  assert.equal(findHotkeyMatch(event, {}, "Global"), null);
});

test("audio cycling wraps and needs a second track", () => {
  assert.equal(nextAudioTrack([]), null);
  assert.equal(nextAudioTrack([audio("1", true)]), null);
  const tracks = [audio("1"), audio("2", true), audio("3")];
  assert.equal(nextAudioTrack(tracks)?.id, "3");
  assert.equal(nextAudioTrack([audio("1"), audio("2"), audio("3", true)])?.id, "1");
  assert.equal(nextAudioTrack([audio("1"), audio("2")])?.id, "1");
});

test("track names prefer the title, then label and language", () => {
  assert.equal(trackDisplayName(audio("1", false, { title: "Commentary" })), "Commentary");
  assert.equal(trackDisplayName(audio("1")), "Track 1");
  assert.equal(trackDisplayName(audio("7", false, { label: "", lang: "ara" })), "ara");
});

test("subtitle size steps stay inside the supported range", () => {
  assert.equal(stepSubFontSize(32, 1), 34);
  assert.equal(stepSubFontSize(32, -1), 30);
  assert.equal(stepSubFontSize(SUB_FONT_SIZE_MAX, 1), SUB_FONT_SIZE_MAX);
  assert.equal(stepSubFontSize(SUB_FONT_SIZE_MIN, -1), SUB_FONT_SIZE_MIN);
  assert.equal(stepSubFontSize(Number.NaN, 1), SUB_FONT_SIZE_MIN + 2);
});
