import assert from "node:assert/strict";
import test from "node:test";
import { playbackTimelineFailure } from "../src/lib/subtitles/autosync/playback-timeline-error.ts";

test("verification failures preserve the cause without suggesting all sources are inaccessible", () => {
  for (const [suffix, expected] of [
    ["timeout", "timed out"],
    ["cache-timeout", "local playback cache"],
    ["source-timeout", "Opening or seeking the source stream"],
    ["probe-failed", "could not read"],
    ["invalid", "missing or unsupported"],
    ["unverified", "consistent timing"],
    ["discontinuous", "contain gaps"],
  ]) {
    const code = `cache-audio-timeline-${suffix}`;
    const result = playbackTimelineFailure(new Error(`${code}: private source details`));
    assert.equal(result?.code, code);
    assert.ok(result?.message.includes(expected));
    assert.ok(result?.message.includes("No correction was applied"));
    assert.ok(!result?.message.includes("private source"));
  }
  assert.equal(playbackTimelineFailure("cache-audio-incomplete"), null);
});

test("embedded subtitle timing failures explain why playback sync cannot continue", () => {
  for (const suffix of ["timeout", "track-ambiguous", "invalid", "read-failed", "insufficient"]) {
    const failure = playbackTimelineFailure(`cache-subtitle-${suffix}: private details`);
    assert.ok(failure?.message.includes("No correction was applied"));
    assert.ok(!failure?.message.includes("private details"));
  }
});
