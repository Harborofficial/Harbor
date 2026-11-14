import assert from "node:assert/strict";
import test from "node:test";
import "./_localstorage-stub.ts";
import { DEFAULT } from "../src/lib/settings/defaults.ts";
import { parseStoredSettings } from "../src/lib/settings/load.ts";
import {
  PROFILES_KEY,
  forkToProfile,
  loadEffective,
  persistEffective,
  readActiveSource,
  recoverSettingsFile,
} from "../src/lib/settings/profile-store.ts";

test("the Harbor mouse cursor is off by default and requires a boolean opt-in", () => {
  assert.equal(parseStoredSettings(null).settings.harborCursor, false);
  assert.equal(parseStoredSettings('{"uiScale":1.2}').settings.harborCursor, false);
  for (const value of ["true", 1, null, {}, [], false]) {
    const raw = JSON.stringify({ harborCursor: value });
    assert.equal(parseStoredSettings(raw).settings.harborCursor, false, raw);
  }
  assert.equal(parseStoredSettings('{"harborCursor":true}').settings.harborCursor, true);
});

test("the manual cursor scale defaults to 100% and accepts only supported slider steps", () => {
  assert.equal(parseStoredSettings(null).settings.harborCursorScale, 1);
  assert.equal(parseStoredSettings('{"harborCursor":true}').settings.harborCursorScale, 1);
  for (const value of ["1.5", null, {}, [], true]) {
    const raw = JSON.stringify({ harborCursorScale: value });
    assert.equal(parseStoredSettings(raw).settings.harborCursorScale, 1, raw);
  }
  assert.equal(parseStoredSettings('{"harborCursorScale":1e999}').settings.harborCursorScale, 1);
  for (const [value, expected] of [
    [-10, 0.75],
    [0.74, 0.75],
    [0.79, 0.8],
    [1.19, 1.2],
    [1.23, 1.25],
    [2.2, 2],
    [1e300, 2],
  ]) {
    const raw = JSON.stringify({ harborCursorScale: value });
    assert.equal(parseStoredSettings(raw).settings.harborCursorScale, expected, raw);
  }
  for (let percent = 75; percent <= 200; percent += 5) {
    const scale = percent / 100;
    const raw = JSON.stringify({ harborCursorScale: scale });
    assert.equal(parseStoredSettings(raw).settings.harborCursorScale, scale, raw);
  }
});

test("the Harbor mouse cursor survives theme changes and uses the active profile's settings", () => {
  localStorage.clear();
  try {
    persistEffective({ ...DEFAULT, harborCursor: true, harborCursorScale: 1.4 }, "default", true);
    forkToProfile("private");
    assert.equal(loadEffective("private", false).harborCursor, true);
    assert.equal(loadEffective("private", false).harborCursorScale, 1.4);

    const shared = loadEffective("default", true);
    persistEffective(
      { ...shared, theme: { ...shared.theme, preset: "midnight" } },
      "default",
      true,
    );
    const separate = loadEffective("private", false);
    persistEffective(
      { ...separate, harborCursor: false, harborCursorScale: 0.85 },
      "private",
      false,
    );

    const profiles = [{ id: "linked" }, { id: "private", settingsLinked: false }];
    for (const [activeId, enabled, scale] of [
      ["private", false, 0.85],
      ["linked", true, 1.4],
      ["private", false, 0.85],
    ] as const) {
      localStorage.setItem(PROFILES_KEY, JSON.stringify({ activeId, profiles }));
      const { profileId, linked } = readActiveSource();
      const settings = loadEffective(profileId, linked);
      assert.equal(settings.harborCursor, enabled);
      assert.equal(settings.harborCursorScale, scale);
    }
  } finally {
    localStorage.clear();
  }
});

test("the native settings backup restores the cursor preference through validation", () => {
  localStorage.clear();
  try {
    const backup = persistEffective(
      { ...DEFAULT, harborCursor: true, harborCursorScale: 1.45 },
      "default",
      true,
    );
    localStorage.clear();
    const recovered = recoverSettingsFile(backup, "default", true);
    assert.equal(recovered?.harborCursor, true);
    assert.equal(recovered?.harborCursorScale, 1.45);
    assert.equal(loadEffective("default", true).harborCursor, true);
    assert.equal(loadEffective("default", true).harborCursorScale, 1.45);
    localStorage.clear();
    assert.equal(
      recoverSettingsFile('{"harborCursor":"true"}', "default", true)?.harborCursor,
      false,
    );
  } finally {
    localStorage.clear();
  }
});
