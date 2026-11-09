import assert from "node:assert/strict";
import test from "node:test";
import { shouldPublishMusicPresence } from "../src/lib/music/presence-gate.ts";
import type { MusicTrack } from "../src/lib/music/types.ts";

const track = { id: "fixture", title: "Song", artist: "Artist" } as MusicTrack;

test("a restored paused song stays off Discord until playback starts", () => {
  assert.equal(shouldPublishMusicPresence({ current: track, phase: "paused" }, false), false);
});

test("playing music publishes even on the first state", () => {
  assert.equal(shouldPublishMusicPresence({ current: track, phase: "playing" }, false), true);
});

test("a paused song in an active session still publishes", () => {
  assert.equal(shouldPublishMusicPresence({ current: track, phase: "paused" }, true), true);
});

test("resolving, idle, error and empty states never publish", () => {
  assert.equal(shouldPublishMusicPresence({ current: track, phase: "resolving" }, true), false);
  assert.equal(shouldPublishMusicPresence({ current: null, phase: "playing" }, true), false);
  assert.equal(shouldPublishMusicPresence({ current: track, phase: "idle" }, true), false);
  assert.equal(shouldPublishMusicPresence({ current: track, phase: "error" }, true), false);
});
