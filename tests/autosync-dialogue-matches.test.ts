// @ts-expect-error Node tests are outside the browser tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node tests are outside the browser tsconfig.
import test from "node:test";
// @ts-expect-error Node tests are outside the browser tsconfig.
import { readFileSync } from "node:fs";
import {
  isLikelyDialogueCue,
  matchDialogueAnchors,
} from "../src/lib/subtitles/autosync/dialogue-matches.ts";
import { summarizeEmbeddedExtraction } from "../src/lib/subtitles/autosync/embedded-extraction.ts";
import { rankDialogueScenes } from "../src/lib/subtitles/autosync/scene-window.ts";
import {
  fitEmbeddedReference,
  fitFocusedEmbeddedReference,
  inspectEmbeddedReference,
} from "../src/lib/subtitles/autosync/embedded-reference.ts";

const cue = (start: number, text: string, len = 1.2) => ({ start, end: start + len, text });

function splitMergedFixture(offset: number, reverse = false) {
  const source = [];
  const windows: Array<{ startSec: number; cues: ReturnType<typeof cue>[] }> = [];
  for (const [region, base] of [200, 1200, 2200].entries()) {
    const refCues = [];
    for (let i = 0; i < 7; i++) {
      const first = `The conversation number ${region} and ${i} happens now`;
      const second = `The other speaker responds for scene ${region} row ${i}`;
      const at = base + 3 + i * 10;
      if (!reverse) {
        source.push(cue(at, first, 0.8), cue(at + 0.9, second, 0.8));
        refCues.push(cue(at + offset, first + " " + second, 1.7));
      } else {
        source.push(cue(at, first + " " + second, 1.7));
        refCues.push(cue(at + offset, first, 0.8), cue(at + offset + 0.9, second, 0.8));
      }
    }
    windows.push({ startSec: base, cues: refCues });
  }
  return { source, windows };
}

test("the scene and embedded-reference paths share the translator-credit filter", () => {
  const credit = "Corrected, translated and syncronized by; ufukbaba from Turkey";
  assert.equal(isLikelyDialogueCue(credit), false);
  assert.equal(isLikelyDialogueCue("[background music]"), false);
  assert.equal(isLikelyDialogueCue("https://example.test/subs"), false);
  assert.equal(isLikelyDialogueCue("As a family."), true);
  const spoken = [
    cue(345, "Please keep your arms up"),
    cue(352, "The group starts together"),
    cue(365, "Now look at the wall"),
  ];
  const withCredit = [...spoken, cue(375, credit)];
  assert.equal(rankDialogueScenes(withCredit, 365, 3600).length, 0);
  const extra = [...withCredit, cue(380, "Close your eyes together")];
  assert.ok(rankDialogueScenes(extra, 365, 3600).length > 0);
  assert.equal(
    matchDialogueAnchors(
      [...spoken, cue(375, credit)],
      [{ startSec: 340, cues: [...spoken, cue(375, credit)] }],
      "en",
    ).length,
    3,
  );
});

test("empty or sparse FFmpeg output is distinct from true text mismatch", () => {
  assert.deepEqual(summarizeEmbeddedExtraction([], "en"), {
    status: "no-excerpts",
    rawCues: 0,
    dialogueCues: 0,
    usableWindows: 0,
  });
  assert.equal(
    summarizeEmbeddedExtraction(
      [{ cues: [cue(375, "Corrected and synchronized by someone"), cue(400, "[Sighs]")] }],
      "en",
    ).status,
    "no-dialogue",
  );
  assert.equal(
    summarizeEmbeddedExtraction(
      [{ cues: [cue(375, "As a family"), cue(380, "Now look up")] }],
      "en",
    ).status,
    "insufficient-dialogue",
  );
  assert.equal(
    summarizeEmbeddedExtraction(
      [
        {
          cues: [
            cue(375, "As a family"),
            cue(380, "Now look up"),
            cue(385, "One more thing"),
            cue(395, "The other person"),
          ],
        },
      ],
      "en",
    ).status,
    "usable",
  );
});

test("one-to-one anchors recover split external phrases against merged embedded cues", () => {
  const { source, windows } = splitMergedFixture(-3.2);
  const anchors = matchDialogueAnchors(source, windows, "en");
  assert.equal(anchors.length, 21);
  assert.ok(anchors.every((a) => a.grouped));
  assert.ok(anchors.every((a) => Math.abs(a.targetSec - a.sourceSec + 3.2) < 0.001));
  const diag = inspectEmbeddedReference(source, windows, "en").diagnostics;
  assert.deepEqual(diag.groupedMatches, [7, 7, 7]);
  assert.deepEqual(diag.plausibleMatches, [7, 7, 7]);
  const fit = fitEmbeddedReference(source, windows, "en", 3600);
  assert.ok(fit);
  assert.ok(Math.abs(fit.transform.offsetSec + 3.2) < 0.001);
  assert.equal(fit.regionCount, 3);
  assert.equal(fit.strongOffset, false, "grouped text must not authorize auto-apply");
  const local = fitFocusedEmbeddedReference(source, windows, "en", 235);
  assert.ok(local);
  assert.equal(local.localOnly, true);
});

test("one-to-one anchors recover merged external phrases against split embedded cues", () => {
  const { source, windows } = splitMergedFixture(5.4, true);
  const anchors = matchDialogueAnchors(source, windows, "en");
  assert.equal(anchors.length, 21);
  assert.ok(anchors.every((a) => a.grouped));
  const fit = fitEmbeddedReference(source, windows, "en", 3600);
  assert.ok(fit);
  assert.ok(Math.abs(fit.transform.offsetSec - 5.4) < 0.001);
  assert.equal(fit.strongOffset, false);
});

test("the player reports extraction failures separately from genuine mismatch and logs numeric evidence", () => {
  const runtime = readFileSync(
    new URL("../src/lib/subtitles/autosync/embedded-reference-runtime.ts", import.meta.url),
    "utf8",
  );
  const hook = readFileSync(
    new URL("../src/views/player/hooks/use-auto-sync.ts", import.meta.url),
    "utf8",
  );
  assert.match(runtime, /extraction\.status !== "usable"/);
  assert.match(runtime, /checked: false,\s*extraction: extraction\.status/);
  assert.match(hook, /embeddedReferenceFailure = !reference\.checked/);
  assert.match(hook, /"extraction-empty"/);
  assert.match(hook, /"extraction-sparse"/);
  assert.match(hook, /embedded-ref=extraction-error/);
  assert.match(hook, /raw-cues=\$\{reference\.rawCueCount\}/);
  assert.match(hook, /dialogue-cues=\$\{reference\.dialogueCueCount\}/);
  assert.match(hook, /grouped-matches=\$\{diagnostic\?\.groupedMatches/);
  assert.match(hook, /independent-audio=refused gate=\$\{o\.decision\.bindingRule\}/);
});

test("unrelated dialogue and repeated phrases cannot fabricate anchors", () => {
  const selected = [
    cue(200, "This dialogue is repeated"),
    cue(210, "This dialogue is repeated"),
    cue(220, "Genuine unique dialogue here"),
  ];
  const reference = [
    { startSec: 195, cues: [cue(205, "This dialogue is repeated"), cue(225, "Unrelated story")] },
  ];
  const anchors = matchDialogueAnchors(selected, reference, "en");
  assert.equal(anchors.length, 0);
  assert.equal(inspectEmbeddedReference(selected, reference, "en").diagnostics.textMatches[0], 0);
});

test("split/merge matching still rejects inconsistent timestamps across regions", () => {
  const { source, windows } = splitMergedFixture(3);
  const manipulated = windows.map((w, i) => ({
    ...w,
    cues: w.cues.map((c) => ({
      ...c,
      start: c.start + (i === 1 ? 8 : 0),
      end: c.end + (i === 1 ? 8 : 0),
    })),
  }));
  assert.equal(fitEmbeddedReference(source, manipulated, "en", 3600), null);
});
