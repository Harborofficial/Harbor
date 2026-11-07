import assert from "node:assert/strict";
import test from "node:test";
import { episodeDownloadAction, sharedPlaybackTorrentRisk } from "../src/components/player/episode-panel/download-action.ts";

// Downloading one episode must never trigger another playback selection.
test("episode panel download actions handle active, saved and retryable transfers", () => {
  assert.equal(episodeDownloadAction(null), "choose");
  assert.equal(episodeDownloadAction("downloading"), "cancel");
  assert.equal(episodeDownloadAction("paused"), "cancel");
  assert.equal(episodeDownloadAction("done"), "saved");
  assert.equal(episodeDownloadAction("error"), "choose");
  assert.equal(episodeDownloadAction("interrupted"), "choose");
  assert.equal(episodeDownloadAction("canceled"), "choose");
});


test("download source selection never reselects the currently streaming P2P torrent", () => {
  const hash = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  assert.equal(sharedPlaybackTorrentRisk(hash, hash.toUpperCase(), true), true);
  assert.equal(sharedPlaybackTorrentRisk(hash, "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", true), false);
  assert.equal(sharedPlaybackTorrentRisk(hash, hash, false), false);
  assert.equal(sharedPlaybackTorrentRisk(null, hash, true), false);
});
