import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const text = (relativePath: string) =>
  readFileSync(new URL("../" + relativePath, import.meta.url), "utf8");

test("Spotify onboarding makes device pairing primary and own-app browsing optional", () => {
  const row = text("src/components/music/music-connections/connection-row.tsx");
  const browsing = text("src/components/music/music-connections/spotify-browsing-app.tsx");
  const translations = text("src/lib/i18n/locales/en/music.ts");
  assert.match(row, /<SpotifyDevicePairing\b/);
  assert.match(row, /<SpotifyBrowsingApp\b/);
  assert.match(browsing, /<details\b/);
  assert.match(browsing, /<SpotifyBrowsingGuide\b/);
  assert.match(translations, /"music\.spotifySetup\.pairTitle": "Pair your Spotify account"/);
  assert.match(translations, /"music\.spotifySetup\.browseOptional": "Optional"/);
  assert.match(translations, /"music\.spotifySetup\.browseBody": "Optional:/);
  assert.doesNotMatch(row, /<SpotifySetupFields\b/);
});

test("browsing-only Spotify authorization is distinct from a live playback pairing", () => {
  const state = text("src-tauri/src/music/spotify/mod.rs");
  const types = text("src/lib/music/types.ts");
  for (const property of ["playback_ready", "playback_linked", "browsing_ready", "own_app_browsing"]) {
    assert.match(state, new RegExp("pub " + property + ": bool"));
  }
  for (const property of ["playbackReady", "playbackLinked", "browsingReady", "ownAppBrowsing"]) {
    assert.match(types, new RegExp(property + ": boolean"));
  }
  assert.match(state, /let connected = playback_linked \|\| browsing_ready/);
  assert.match(state, /fn browsing_only_oauth_is_connected_without_claiming_playback/);
});
