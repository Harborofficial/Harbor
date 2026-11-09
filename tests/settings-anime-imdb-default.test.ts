import assert from "node:assert/strict";
import test from "node:test";
import "./_localstorage-stub.ts";
import { DEFAULT } from "../src/lib/settings/defaults.ts";
import { parseStoredSettings } from "../src/lib/settings/load.ts";

test("prefer IMDb IDs for anime defaults on", () => {
  assert.equal(DEFAULT.animePreferImdbStreams, true);
  assert.equal(parseStoredSettings(null).settings.animePreferImdbStreams, true);
  assert.equal(parseStoredSettings(JSON.stringify({})).settings.animePreferImdbStreams, true);
});

test("an explicit opt-out survives", () => {
  const raw = JSON.stringify({ ...DEFAULT, animePreferImdbStreams: false });
  assert.equal(parseStoredSettings(raw).settings.animePreferImdbStreams, false);
});
