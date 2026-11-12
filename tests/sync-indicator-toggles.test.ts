import assert from "node:assert/strict";
import test from "node:test";
import "./_localstorage-stub.ts";
import { parseStoredSettings } from "../src/lib/settings/load.ts";

test("AniList and MyAnimeList sync indicators default on", () => {
  const settings = parseStoredSettings(null).settings;
  assert.equal(settings.anilistSyncIndicator, true);
  assert.equal(settings.malSyncIndicator, true);
});

test("each tracker keeps its own sync indicator choice", () => {
  const settings = parseStoredSettings(
    JSON.stringify({ anilistSyncIndicator: false, malSyncIndicator: true }),
  ).settings;
  assert.equal(settings.anilistSyncIndicator, false);
  assert.equal(settings.malSyncIndicator, true);
});

test("the legacy shared toggle seeds both trackers, but explicit choices win", () => {
  const legacy = parseStoredSettings(JSON.stringify({ syncIndicator: false })).settings;
  assert.equal(legacy.anilistSyncIndicator, false);
  assert.equal(legacy.malSyncIndicator, false);

  const mixed = parseStoredSettings(
    JSON.stringify({ syncIndicator: false, malSyncIndicator: true }),
  ).settings;
  assert.equal(mixed.anilistSyncIndicator, false);
  assert.equal(mixed.malSyncIndicator, true);
});
