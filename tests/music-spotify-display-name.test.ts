import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path: string): string {
  return readFileSync(new URL("../" + path, import.meta.url), "utf8");
}

test("Spotify account IDs stay internal, and user-facing connection labels use display names", () => {
  const backend = source("src-tauri/src/music/spotify/mod.rs");
  const types = source("src/lib/music/types.ts");
  const picker = source("src/components/music/music-source-picker.tsx");
  assert.match(backend, /username:\s*playback_linked\.then\(/);
  assert.match(backend, /display_name:\s*connected\.then\(/);
  assert.match(backend, /connection\.account = status\.display_name;/);
  assert.doesNotMatch(backend, /connection\.account = status\.username;/);
  assert.match(types, /displayName\?: string \| null/);
  assert.match(picker, /spotify\.displayName \?\? "Spotify"/);
  assert.doesNotMatch(picker, /spotify\.username \?\? "Spotify"/);
});

test("Spotify library header reads /me display_name, not the connected-account ID", () => {
  const libraryBackend = source("src-tauri/src/music/spotify/library.rs");
  const libraryView = source("src/components/music/music-spotify-library.tsx");
  const parser = source("src-tauri/src/music/spotify/parse.rs");
  assert.match(libraryBackend, /get\("display_name"\)/);
  assert.match(libraryBackend, /account_display_name,/);
  assert.match(libraryView, /page\?\.accountDisplayName \?\? t\("music\.spotifyLibrary\.body"\)/);
  assert.doesNotMatch(libraryView, /\? account\?\.account/);
  // Playlist ownership must continue to compare immutable IDs, not display names.
  assert.match(libraryBackend, /pointer\("\/owner\/id"\)/);
  assert.match(parser, /pointer\("\/owner\/display_name"\)/);
});
