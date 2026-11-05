import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fitEmbeddedTimingReference } from "../src/lib/subtitles/autosync/embedded-timing-reference.ts";
import { chooseEmbeddedReferenceTrack } from "../src/lib/subtitles/autosync/embedded-reference.ts";
import type { TrackInfo } from "../src/lib/player/bridge.ts";
import type { EmbeddedFitTrace } from "../src/lib/subtitles/autosync/embedded-reference.ts";
import { embeddedExcerptCues } from "../src/lib/subtitles/autosync/embedded-extraction.ts";

test("absolute FFmpeg timestamps and relative indexed cues keep the same media clock", () => {
  const absolute = embeddedExcerptCues({
    startSec: 613.783,
    lenSec: 90,
    timestampsAbsolute: true,
    srt: "1\n00:10:08,950 --> 00:10:13,250\nPrevious cue\n\n2\n00:10:15,000 --> 00:10:17,000\nDialogue\n",
  });
  const relative = embeddedExcerptCues({
    startSec: 613.783,
    lenSec: 90,
    srt: "1\n00:00:01,217 --> 00:00:03,217\nDialogue\n",
  });
  assert.deepEqual(absolute, [{ start: 615, end: 617, text: "Dialogue" }]);
  assert.deepEqual(relative, absolute);
});

// Numeric timing only from the reported English/Traditional Chinese subtitle pair.
const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/anime-embedded-timing.json", import.meta.url), "utf8"),
) as {
  durationSec: number;
  target: Array<[number, number]>;
  regions: Array<{ startSec: number; lenSec: number; cues: Array<[number, number]> }>;
  focusRegions: Array<{
    focus: number;
    regions: Array<{ startSec: number; lenSec: number; cues: Array<[number, number]> }>;
  }>;
};
const target = fixture.target.map(([start, end], i) => ({
  start,
  end,
  text: `translated dialogue ${i}`,
}));
const regions = fixture.regions.map((region, r) => ({
  ...region,
  cues: region.cues.map(([start, end], i) => ({ start, end, text: `embedded dialogue ${r} ${i}` })),
}));

test("embedded timing finds the same correction at 10:50 and 11:00", () => {
  for (const sample of fixture.focusRegions) {
    const excerpts = sample.regions.map((region, r) => ({
      ...region,
      cues: region.cues.map(([start, end], i) => ({ start, end, text: `dialogue ${r} ${i}` })),
    }));
    const fit = fitEmbeddedTimingReference(target, excerpts, fixture.durationSec);
    assert.equal(fit?.transform.offsetSec, -11, `focus ${sample.focus}`);
    assert.equal(fit?.strongOffset, false);
  }
});

test("English embedded timing recovers the reported Chinese subtitle's eleven-second delay", () => {
  const fit = fitEmbeddedTimingReference(target, regions, fixture.durationSec);
  assert.ok(fit);
  assert.equal(fit.transform.offsetSec, -11);
  assert.equal(fit.transform.ratio, 1);
  assert.ok(fit.regionCount >= 2 && fit.heldOutCount >= 1);
  assert.equal(fit.strongOffset, false, "different-language references must never auto-apply");
});

test("one region, repeated seeks, and inconsistent scene offsets cannot authorize a reference shift", () => {
  const trace: EmbeddedFitTrace = {
    reason: "bad-input",
    anchorCount: 0,
    regionAnchorCounts: [],
    heldOutMedianSec: null,
    heldOutP90Sec: null,
    candidateOffsetSec: null,
    candidateRatio: null,
  };
  assert.equal(fitEmbeddedTimingReference(target, [regions[1]], fixture.durationSec, trace), null);
  assert.equal(trace.reason, "insufficient-regions");
  assert.equal(trace.timingWindows?.length, 1);
  assert.ok(trace.timingWindows?.every((w) => !Object.hasOwn(w, "text")));
  assert.equal(fitEmbeddedTimingReference(target, [regions[1]], fixture.durationSec), null);
  const repeated = {
    ...regions[2],
    cues: regions[1].cues.map((cue) => ({
      ...cue,
      start: cue.start + regions[2].startSec - regions[1].startSec,
      end: cue.end + regions[2].startSec - regions[1].startSec,
    })),
  };
  assert.equal(
    fitEmbeddedTimingReference(target, [regions[1], repeated], fixture.durationSec),
    null,
  );
  const inconsistent = target.map((cue) =>
    cue.start > 1000 ? { ...cue, start: cue.start + 6, end: cue.end + 6 } : cue,
  );
  assert.equal(fitEmbeddedTimingReference(inconsistent, regions, fixture.durationSec), null);
});

test("cross-language selection is opt-in, prefers the same language, and still excludes bitmap or signs tracks", () => {
  const selected = { id: "external", kind: "subtitle", external: true, lang: "zht" } as TrackInfo;
  const english = { id: "en", kind: "subtitle", lang: "en", codec: "ass" } as TrackInfo;
  const chinese = { ...english, id: "zh", lang: "zht" };
  assert.equal(chooseEmbeddedReferenceTrack([english], selected), null);
  assert.equal(chooseEmbeddedReferenceTrack([english], selected, true)?.track.id, "en");
  assert.equal(chooseEmbeddedReferenceTrack([english, chinese], selected, true)?.track.id, "zh");
  assert.equal(
    chooseEmbeddedReferenceTrack([{ ...english, codec: "hdmv_pgs_subtitle" }], selected, true),
    null,
  );
  assert.equal(
    chooseEmbeddedReferenceTrack([{ ...english, title: "Signs & Songs" }], selected, true),
    null,
  );
});
