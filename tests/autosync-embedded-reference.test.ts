import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  chooseEmbeddedReferenceTrack,
  embeddedReferenceWindows,
  fitEmbeddedReference,
  fitFocusedEmbeddedReference,
  inspectEmbeddedReference,
} from "../src/lib/subtitles/autosync/embedded-reference.ts";

const duration = 3600;
const cues = Array.from({ length: 440 }, (_, i) => ({
  start: 30 + i * 8,
  end: 32 + i * 8,
  text: `My original dialogue sentence number ${i} has unique content`,
}));
function windowsFor(offset: number, ratio = 1, corruptedRegion = -1) {
  return embeddedReferenceWindows(duration).map(({ startSec, lenSec }, region) => ({
    startSec,
    cues: cues
      .map((c) => ({
        start: offset + ratio * c.start + (region === corruptedRegion ? 6 : 0),
        end: offset + ratio * c.end + (region === corruptedRegion ? 6 : 0),
        text: c.text,
      }))
      .filter((c) => c.start >= startSec && c.start < startSec + lenSec),
  }));
}

test("embedded reference is only an eligible, matching-language text track", () => {
  const selected = { id: "external", kind: "subtitle", external: true, lang: "en" };
  const tracks = [
    { kind: "subtitle", id: "pgs", lang: "en", codec: "hdmv_pgs_subtitle" },
    { kind: "subtitle", id: "forced", lang: "en", codec: "subrip", forced: true },
    { kind: "subtitle", id: "spanish", lang: "es", codec: "subrip" },
    { kind: "subtitle", id: "english", lang: "en", codec: "subrip", label: "English" },
    selected,
  ];
  assert.deepEqual(chooseEmbeddedReferenceTrack(tracks as never, selected as never), {
    track: tracks[3],
    index: 3,
  });
  assert.equal(
    chooseEmbeddedReferenceTrack(tracks as never, { ...selected, lang: "fr" } as never),
    null,
  );
  assert.equal(
    chooseEmbeddedReferenceTrack(tracks as never, { ...selected, lang: "eng" } as never)?.index,
    3,
  );
  assert.equal(
    chooseEmbeddedReferenceTrack(tracks as never, { ...selected, external: false } as never),
    null,
  );
  assert.equal(
    chooseEmbeddedReferenceTrack(tracks as never, { ...selected, lang: undefined } as never),
    null,
  );
});

test("reference windows are bounded and spread across the program", () => {
  const windows = embeddedReferenceWindows(duration);
  assert.equal(windows.length, 3);
  assert.ok(windows.every((w) => w.lenSec === 90));
  assert.ok(windows[1].startSec - (windows[0].startSec + 90) > 100);
  assert.ok(windows[2].startSec - (windows[1].startSec + 90) > 100);
  assert.deepEqual(embeddedReferenceWindows(100), []);
});

test("embedded reference identifies a constant delay and retains withheld evidence", () => {
  const fit = fitEmbeddedReference(cues, windowsFor(-2.5), "en", duration);
  assert.ok(fit);
  assert.equal(fit.transform.kind, "affine");
  assert.ok(Math.abs(fit.transform.offsetSec + 2.5) < 0.05);
  assert.equal(fit.transform.ratio, 1);
  assert.equal(fit.regionCount, 3);
  assert.ok(fit.heldOutCount >= 5);
  assert.equal(fit.strongOffset, true);
  assert.equal(fit.alreadyAligned, false);
});

test("embedded reference detects when the subtitles are already synchronized", () => {
  const fit = fitEmbeddedReference(cues, windowsFor(0), "en", duration);
  assert.ok(fit);
  assert.equal(fit.alreadyAligned, true);
  assert.equal(fit.strongOffset, false);
  assert.equal(fit.maximumChangeSec, 0);
});

test("a negligible embedded timing shift cannot be advertised as an applied correction", () => {
  const fit = fitEmbeddedReference(cues, windowsFor(0.12, 1.00002), "en", duration);
  assert.ok(fit);
  assert.equal(fit.alreadyAligned, true);
  assert.equal(fit.strongOffset, false);
  assert.ok(fit.maximumChangeSec < 0.25);
});

test("a verified frame-rate conversion stays structural and cannot auto-apply as a delay", () => {
  const fit = fitEmbeddedReference(cues, windowsFor(-4, 25 / 24), "en", duration);
  assert.ok(fit);
  assert.equal(fit.transform.kind, "affine");
  assert.ok(Math.abs(fit.transform.ratio - 25 / 24) < 0.002);
  assert.equal(fit.strongOffset, false);
});

test("multi-region evidence rejects a subtitle from a different cut", () => {
  const fit = fitEmbeddedReference(cues, windowsFor(-2.5, 1, 1), "en", duration);
  assert.equal(fit, null);
});

test("a single window or incomplete reference cannot authorize a correction", () => {
  const reference = windowsFor(-2.5);
  assert.equal(fitEmbeddedReference(cues, reference.slice(0, 1), "en", duration), null);
  assert.equal(
    fitEmbeddedReference(
      cues,
      reference.map((w) => ({ ...w, cues: w.cues.slice(0, 2) })),
      "en",
      duration,
    ),
    null,
  );
  assert.equal(fitEmbeddedReference(cues, [], "en", duration), null);
});

test("non-unique repeated dialogue cannot fabricate text anchors", () => {
  const duplicated = cues.map((c) => ({ ...c, text: "Thank you" }));
  const refs = windowsFor(-4).map((w) => ({
    ...w,
    cues: w.cues.map((c) => ({ ...c, text: "Thank you" })),
  }));
  assert.equal(fitEmbeddedReference(duplicated, refs, "en", duration), null);
});

test("the Auto sync pipeline checks embedded text before independent audio, without switching tracks", () => {
  const hook = readFileSync(
    new URL("../src/views/player/hooks/use-auto-sync.ts", import.meta.url),
    "utf8",
  );
  const runtime = readFileSync(
    new URL("../src/lib/subtitles/autosync/embedded-reference-runtime.ts", import.meta.url),
    "utf8",
  );
  const native = readFileSync(
    new URL("../src-tauri/src/subsync/embedded_reference.rs", import.meta.url),
    "utf8",
  );
  assert.ok(hook.indexOf("await readEmbeddedReference(") < hook.indexOf("const ctx = {"));
  assert.match(hook, /handleOutcome\(outcome, cues, fmt, cancelled, statusScope\)/);
  assert.match(runtime, /"subsync_embedded_reference"/);
  assert.match(runtime, /embeddedExcerptCues\(excerpt\)/);
  assert.match(native, /arg\("-copyts"\)/);
  assert.match(native, /"-avoid_negative_ts", "disabled"/);
  assert.match(native, /timestamps_absolute: true/);
  assert.match(
    native,
    /if excerpts\.len\(\) >= 2/,
    "one indexed excerpt must not skip independent fallback reads",
  );
  assert.match(native, /kill_on_drop\(true\)/);
  assert.match(native, /analysis_control::run/);
  assert.doesNotMatch(native, /set_property\(/);
  assert.match(hook, /b.setSubDelay\(a.subDelayBefore \+ t.offsetSec\)/);
  assert.match(hook, /embedded-ref=.*offset=.*ratio=.*max-shift=.*playhead-shift=/);
  assert.match(hook, /offer-rejected=no-perceptible-timing-change/);
  assert.match(hook, /o\.decision\.bindingRule !== "embedded-text-reference"/);
  assert.match(hook, /offer-applied=\$\{o\.decision\.bindingRule\} offset=/);
  const popover = readFileSync(
    new URL("../src/components/player/autosync/autosync-popover.tsx", import.meta.url),
    "utf8",
  );
  assert.match(popover, /% drift/);
});

test("duplicate network seek segments cannot erase otherwise valid multi-region reference matches", () => {
  const original = windowsFor(-2.5);
  const wrongJump = original[2].startSec - original[0].startSec;
  const repeatedThird = {
    startSec: original[2].startSec,
    cues: original[0].cues.map((cue) => ({
      ...cue,
      start: cue.start + wrongJump,
      end: cue.end + wrongJump,
    })),
  };
  const extracted = [original[0], original[1], repeatedThird];
  const diagnostics = inspectEmbeddedReference(cues, extracted, "en");
  assert.ok(diagnostics.diagnostics.textMatches[2] >= 4);
  assert.equal(diagnostics.diagnostics.plausibleMatches[2], 0);
  assert.equal(diagnostics.diagnostics.repeatedWindows, 1);
  assert.equal(diagnostics.windows.length, 2);
  const fit = fitEmbeddedReference(cues, extracted, "en", duration);
  assert.ok(fit);
  assert.ok(Math.abs(fit.transform.offsetSec + 2.5) < 0.05);
  assert.equal(fit.regionCount, 2);
});

test("all repeated network seeks cannot fabricate two independent reference regions", () => {
  const original = windowsFor(-2.5);
  const first = original[0];
  const repeated = original.map(({ startSec }) => ({
    startSec,
    cues: first.cues.map((cue) => ({
      ...cue,
      start: cue.start + startSec - first.startSec,
      end: cue.end + startSec - first.startSec,
    })),
  }));
  const diagnostics = inspectEmbeddedReference(cues, repeated, "en");
  assert.ok(diagnostics.diagnostics.repeatedWindows >= 2);
  assert.equal(fitEmbeddedReference(cues, repeated, "en", duration), null);
});

test("reference diagnostics distinguish different text from duplicate seeks", () => {
  const unrelated = windowsFor(-3.5).map((window) => ({
    ...window,
    cues: window.cues.map((cue) => ({ ...cue, text: "unrelated show content" })),
  }));
  const diagnostics = inspectEmbeddedReference(cues, unrelated, "en").diagnostics;
  assert.deepEqual(diagnostics.textMatches, [0, 0, 0]);
  assert.deepEqual(diagnostics.plausibleMatches, [0, 0, 0]);
  assert.equal(fitEmbeddedReference(cues, unrelated, "en", duration), null);
  const hook = readFileSync(
    new URL("../src/views/player/hooks/use-auto-sync.ts", import.meta.url),
    "utf8",
  );
  assert.match(hook, /text-overlap=\$\{diagnostic\?\.textMatches\.join/);
  assert.match(hook, /repeated-seeks=\$\{diagnostic\?\.repeatedWindows/);
});

test("separate audio verification gets a full deadline after reference extraction", () => {
  const hook = readFileSync(
    new URL("../src/views/player/hooks/use-auto-sync.ts", import.meta.url),
    "utf8",
  );
  const first = hook.indexOf('armDeadline("embedded")');
  const ref = hook.indexOf("await readEmbeddedReference(");
  const audio = hook.indexOf('armDeadline("audio")');
  assert.ok(first > 0 && first < ref && audio > ref);
  assert.match(hook, /failure=analysis-deadline phase=\$\{phase\}/);
  assert.match(hook, /cancelNativeAnalysis\(nativeSessionId\)/);
});

test("sparse but identical dialogue across three regions can support a text-only proposal", () => {
  const counts = [7, 13, 8];
  const reference = windowsFor(-3.5).map((window, region) => ({
    ...window,
    cues: window.cues.map((cue, index) =>
      index < counts[region]
        ? cue
        : {
            ...cue,
            text: `Unrelated alternate cut region ${region} line ${index}`,
          },
    ),
  }));
  const diagnostic = inspectEmbeddedReference(cues, reference, "en");
  assert.deepEqual(diagnostic.diagnostics.plausibleMatches, [7, 11, 8]);
  const fit = fitEmbeddedReference(cues, reference, "en", duration);
  assert.ok(fit, "Sparse independently unique matching lines should yield a verified offset");
  assert.ok(Math.abs(fit.transform.offsetSec + 3.5) < 0.1);
  assert.ok(fit.heldOutCount >= 5);
});

test("fifteen independently matched lines in three distant regions can support an offer, not an automatic apply", () => {
  const reference = windowsFor(-4.75).map((window, region) => ({
    ...window,
    cues: window.cues.map((cue, index) =>
      index < 5
        ? cue
        : {
            ...cue,
            text: `Unmatched dialogue in region ${region} cue ${index}`,
          },
    ),
  }));
  const trace = {
    reason: "bad-input" as const,
    anchorCount: 0,
    regionAnchorCounts: [] as number[],
    heldOutMedianSec: null as number | null,
    heldOutP90Sec: null as number | null,
    candidateOffsetSec: null as number | null,
    candidateRatio: null as number | null,
  };
  const fit = fitEmbeddedReference(cues, reference, "en", duration, trace);
  assert.ok(fit, `Fit rejected 15 validated lines: ${trace.reason}`);
  assert.ok(Math.abs(fit.transform.offsetSec + 4.75) < 0.1);
  assert.equal(fit.strongOffset, false);
  assert.equal(trace.reason, "verified");
  assert.deepEqual(trace.regionAnchorCounts, [5, 5, 5]);
});

test("a timing-inconsistent reference explains its actual fitting failure instead of claiming no text matched", () => {
  const trace = {
    reason: "bad-input" as const,
    anchorCount: 0,
    regionAnchorCounts: [] as number[],
    heldOutMedianSec: null as number | null,
    heldOutP90Sec: null as number | null,
    candidateOffsetSec: null as number | null,
    candidateRatio: null as number | null,
  };
  const reference = windowsFor(-2.5, 1, 1);
  const inspected = inspectEmbeddedReference(cues, reference, "en");
  assert.ok(inspected.diagnostics.plausibleMatches.reduce((sum, n) => sum + n, 0) >= 18);
  assert.equal(fitEmbeddedReference(cues, reference, "en", duration, trace), null);
  assert.ok(trace.anchorCount >= 18);
  assert.ok(
    ["heldout-inconsistent", "region-inconsistent", "model-unavailable"].includes(trace.reason),
    `Unexpected rejection: ${trace.reason}`,
  );
});

test("embedded timing diagnostics expose only numeric deltas and never subtitle text", () => {
  const diagnostics = inspectEmbeddedReference(cues, windowsFor(-4.5), "en").diagnostics;
  assert.ok(diagnostics.windowMedianOffsets.every((x) => x !== null && Math.abs(x + 4.5) < 0.01));
  assert.ok(diagnostics.windowOffsetMad.every((x) => (x ?? Infinity) < 0.05));
  const runtime = readFileSync(
    new URL("../src/lib/subtitles/autosync/embedded-reference-runtime.ts", import.meta.url),
    "utf8",
  );
  assert.match(runtime, /const fitTrace/);
  const hook = readFileSync(
    new URL("../src/views/player/hooks/use-auto-sync.ts", import.meta.url),
    "utf8",
  );
  assert.match(hook, /rejection=\$\{trace\?\.reason/);
  assert.match(hook, /median-deltas=\$\{values/);
  assert.match(hook, /timing-inconsistent/);
});

test("embedded reference samples the playback scene rather than extrapolating from distant scenes", () => {
  const positioned = embeddedReferenceWindows(duration, 569);
  assert.equal(positioned.length, 3);
  assert.ok(positioned.some((w) => w.startSec <= 569 && 569 < w.startSec + w.lenSec));
  assert.ok(positioned.some((w) => w.startSec > 1000));
  const reference = positioned.map((w, index) => ({
    startSec: w.startSec,
    cues: cues
      .map((c) => ({
        ...c,
        start: c.start + (index === 0 ? 4.2 : index === 1 ? 6.1 : 8),
        end: c.end + (index === 0 ? 4.2 : index === 1 ? 6.1 : 8),
      }))
      .filter((c) => c.start >= w.startSec && c.start < w.startSec + w.lenSec),
  }));
  const local = fitFocusedEmbeddedReference(cues, reference, "en", 569);
  assert.ok(local);
  assert.equal(local.localOnly, true);
  assert.equal(local.strongOffset, false);
  assert.ok(Math.abs(local.transform.offsetSec - 4.2) < 0.02);
  assert.equal(local.transform.ratio, 1);
  // The original global affine model must not be treated as adequate
  // evidence that the *currently playing scene* has been corrected.
  const global = fitEmbeddedReference(cues, reference, "en", duration);
  assert.ok(
    !global ||
      Math.abs(
        global.transform.offsetSec + (global.transform.ratio - 1) * 569 - local.transform.offsetSec,
      ) > 0.5,
  );
});

test("focus correction refuses inconsistent local timestamps", () => {
  const windows = embeddedReferenceWindows(duration, 569);
  const reference = windows.map((w, index) => ({
    startSec: w.startSec,
    cues: cues
      .map((c, i) => ({
        ...c,
        start: c.start + (index === 0 && i % 2 ? 8 : 4),
        end: c.end + (index === 0 && i % 2 ? 8 : 4),
      }))
      .filter((c) => c.start >= w.startSec && c.start < w.startSec + w.lenSec),
  }));
  assert.equal(fitFocusedEmbeddedReference(cues, reference, "en", 569), null);
});

test("focused reference is offered with local-only safety and not counted as audio verification", () => {
  const hook = readFileSync(
    new URL("../src/views/player/hooks/use-auto-sync.ts", import.meta.url),
    "utf8",
  );
  const runtime = readFileSync(
    new URL("../src/lib/subtitles/autosync/embedded-reference-runtime.ts", import.meta.url),
    "utf8",
  );
  assert.match(hook, /focusSec: getPlaybackPosition\(\)/);
  assert.match(runtime, /embeddedReferenceWindows\(input.durationSec, input.focusSec\)/);
  assert.match(runtime, /fitFocusedEmbeddedReference\(/);
  assert.match(hook, /"embedded-text-reference-local"/);
  assert.match(hook, /fit.strongOffset && !fit.localOnly/);
});

test("a scene-calibrated suggestion is not applied after playback moves to another scene", () => {
  const hook = readFileSync(
    new URL("../src/views/player/hooks/use-auto-sync.ts", import.meta.url),
    "utf8",
  );
  assert.match(hook, /localReferenceFocusRef\.current = \{/);
  assert.match(hook, /local\.scope !== statusScope/);
  assert.match(hook, /Math\.abs\(getPlaybackPosition\(\) - local\.positionSec\) > 90/);
  assert.match(hook, /Playback moved away from the calibrated scene/);
});
