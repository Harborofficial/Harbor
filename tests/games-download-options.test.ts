import assert from "node:assert/strict";
import test from "node:test";
import { sourceDownloadAction } from "../src/lib/games/source-links.ts";
import enGameSource from "../src/lib/i18n/locales/en/game-source-discovery.ts";

test("all game source kinds show one unified download chooser when available", () => {
  for (const kind of ["magnet", "direct", "page"] as const) {
    assert.equal(sourceDownloadAction(kind, true), "options", kind);
  }
});

test("without a chooser, each source keeps its existing safe fallback", () => {
  assert.equal(sourceDownloadAction("magnet", false), "torrent");
  assert.equal(sourceDownloadAction("direct", false), "direct");
  assert.equal(sourceDownloadAction("page", false), "source");
});

test("new download labels resolve from the main English translation catalog", () => {
  for (const key of [
    "games.magnet.debrid",
    "games.magnet.choose",
    "games.magnet.none",
    "games.sources.links.none",
    "games.sources.download.native",
    "games.sources.download.direct",
    "games.sources.download.method",
  ]) {
    assert.ok(enGameSource[key as keyof typeof enGameSource], key);
  }
  assert.equal(enGameSource["games.magnet.debrid"], "Download via Debrid");
  assert.equal(enGameSource["games.sources.links.title"], "Download options");
});
