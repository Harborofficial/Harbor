// @ts-expect-error Node-only tests
import assert from "node:assert/strict";
// @ts-expect-error Node-only tests
import test from "node:test";
import { parseStream } from "../src/lib/streams/parser.ts";
import { applyTrust, titleMatches } from "../src/lib/streams/trust.ts";

test("Arabic titles are compared as real words", () => {
  assert.equal(titleMatches("طالع نازل", "طالع نازل", null, null), true);
  assert.equal(titleMatches("طالع نازل", "مسلسل مختلف تماما", null, null), false);
});

test("unknown cross-script titles are not assumed to match", () => {
  assert.equal(titleMatches("طالع نازل", "Tale3 NazeI", null, null), false);
  assert.equal(titleMatches("When Nora Sees Us", "حين لا يرانا أحد", null, null), false);
  assert.equal(titleMatches("Up and Down", "تحت السن", null, null), false);
});

test("verified Arabic alias allows a matching release but not an unrelated series", () => {
  const releases = [
    parseStream({ addonId: "aradeb", title: "[H265][2160p][SHAHID][S01][2026] حين لا يرانا أحد", url: "https://example.org/right.m3u8", behaviorHints: { videoSize: 2 * 1024 ** 3 } }),
    parseStream({ addonId: "aradeb", title: "[H265][2160p][SHAHID][S01][2026] تحت السن", url: "https://example.org/wrong.m3u8", behaviorHints: { videoSize: 2 * 1024 ** 3 } }),
  ];
  const outcome = applyTrust(releases, { kind: "series", strict: true, expectedTitle: "When No One Sees Us", expectedTitles: ["حين لا يرانا أحد"], expectedSeason: 1, expectedEpisode: 1, allowSeasonPacks: true });
  assert.equal(outcome.keep.length, 1);
  assert.equal(outcome.rejected.length, 1);
  assert.equal(outcome.rejected[0].reason, "title-mismatch");
});

test("strict episode selection rejects season-only packs without file index", () => {
  const release = parseStream({ addonId: "aradeb", title: "[H265][2160p][SHAHID][S01][2026] تحت السن", url: "https://example.org/season.m3u8", behaviorHints: { videoSize: 2 * 1024 ** 3 } });
  const outcome = applyTrust([release], { kind: "series", strict: true, expectedTitle: "Underage", expectedTitles: ["تحت السن"], expectedSeason: 1, expectedEpisode: 1, allowSeasonPacks: false });
  assert.equal(outcome.keep.length, 0);
  assert.equal(outcome.rejected[0].reason, "season-pack-not-episode");
});

test("cross-script results still reject clearly wrong season and episode", () => {
  const streams = [
    parseStream({ addonId: "aradeb", title: "طالع نازل S01E01 720p HDTV", url: "https://example.org/1.m3u8", behaviorHints: { videoSize: 600 * 1024 * 1024 } }),
    parseStream({ addonId: "aradeb", title: "طالع نازل S01E08 720p HDTV", url: "https://example.org/8.m3u8", behaviorHints: { videoSize: 600 * 1024 * 1024 } }),
  ];
  const result = applyTrust(streams, { kind: "series", strict: true, expectedTitle: "When Nora Sees Us", expectedTitles: ["طالع نازل"], expectedSeason: 1, expectedEpisode: 1 });
  assert.equal(result.keep.length, 1);
  assert.equal(result.rejected.length, 1);
  assert.match(result.rejected[0].reason, /episode-mismatch/);
});
