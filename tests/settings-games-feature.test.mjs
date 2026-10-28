import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  quickLibraryAvailable,
  quickLibraryMode,
} from "../src/lib/features/quick-library.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Quick library follows the installed Games and Music components", () => {
  assert.equal(quickLibraryAvailable(false, false), false);
  assert.equal(quickLibraryAvailable(false, true), true);
  assert.equal(quickLibraryAvailable(true, false), true);

  assert.equal(quickLibraryMode(false, true, "games"), "music");
  assert.equal(quickLibraryMode(false, false, "games"), "music");
  assert.equal(quickLibraryMode(true, false, "music"), "games");
  assert.equal(quickLibraryMode(true, true, "games"), "games");
  assert.equal(quickLibraryMode(true, true, "music"), "music");
});

test("game settings follow the installer's Games component", () => {
  const display = read("src/views/settings/theme-panel/display-section.tsx");
  assert.match(display, /const features = useInstallFeatures\(\);/);
  assert.match(
    display,
    /const libraryAvailable = quickLibraryAvailable\(features\.games, features\.music\);/,
  );
  assert.match(display, /label=\{t\("games\.dock\.settingTitle"\)\}/);
  assert.match(display, /\{gamesEnabled && \(/);
  assert.doesNotMatch(display, /GAMES_SETTINGS_VISIBLE/);

  const copy = read("src/lib/i18n/locales/en/game-dock.ts");
  assert.match(copy, /"games\.dock\.settingTitle": "Quick library"/);

  for (const path of [
    "src/views/settings/game-metadata-setting.tsx",
    "src/views/settings/search-shortcuts-section.tsx",
  ]) {
    const source = read(path);
    assert.match(source, /const gamesEnabled = useInstallFeatures\(\)\.games;/);
    assert.match(source, /if \(!gamesEnabled\) return null;/);
  }
});

test("game settings stay out of search and the calendar when Games is disabled", () => {
  const nav = read("src/views/settings/nav.tsx");
  assert.equal(nav.match(/feature: "games"/g)?.length, 5);
  assert.equal(nav.match(/feature: "library"/g)?.length, 1);
  assert.match(nav, /\(o\.feature !== "games" \|\| gamesEnabled\)/);
  assert.match(nav, /\(o\.feature !== "library" \|\| libraryEnabled\)/);

  const app = read("src/App.tsx");
  assert.match(app, /gamesAllowed=\{!kid && GAMES_IN_NAV && installFeatures\.games\}/);
  assert.match(app, /enabled=\{installFeatures\.games && !kid/);
  assert.match(app, /<GameLibraryDock visible=\{quickLibraryVisible && !gamesTop\} \/>/);
});

test("Quick library remains available while game-only search and navigation stay hidden", () => {
  const dock = read("src/views/games/game-library-dock.tsx");
  assert.match(dock, /const musicEnabled = features\.music;/);
  assert.match(dock, /quickLibraryMode\(gamesEnabled, musicEnabled, requestedMode\)/);
  assert.match(dock, /\{gamesEnabled && musicEnabled && <HoverTooltip/);

  const search = read("src/components/search/search-overlay.tsx");
  assert.match(search, /useInstallFeatures/);
  assert.match(search, /activeProfile\?\.kid \|\| !gamesEnabled/);

  for (const path of [
    "src/chrome/nav-edit.tsx",
    "src/views/settings/theme-panel/theme-studio/nav-editor.tsx",
  ]) {
    const source = read(path);
    assert.match(source, /const gamesEnabled = useInstallFeatures\(\)\.games;/);
    assert.match(source, /\.id !== "games" \|\| gamesEnabled/);
  }
});
