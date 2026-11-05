// @ts-expect-error Node test types are intentionally outside the browser tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are intentionally outside the browser tsconfig.
import test from "node:test";
import {
  clearSavedAutoSyncCorrection,
  hasSavedAutoSyncCorrection,
  readSavedAutoSyncCorrection,
  saveAutoSyncCorrection,
  shouldRestoreAutoSyncCorrection,
  subtitleCueFingerprint,
} from "../src/lib/subtitles/autosync/persistence.ts";
import { transformCues } from "../src/lib/subtitles/autosync/html5-sync.ts";
import {
  readPlayerPrefs,
  writePlayerPrefs,
  registerPlayerSubDelayMapper,
} from "../src/lib/player-prefs.ts";

const memory = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => {
      memory.set(key, value);
    },
  },
});

const cues = [
  { start: 10, end: 11, text: "First dialogue" },
  { start: 19, end: 20, text: "Second dialogue" },
  { start: 31, end: 33, text: "Third dialogue" },
  { start: 49, end: 51, text: "Fourth dialogue" },
];
const scope = {
  mediaKey: "episode:show:S1E1:source-secret-token",
  audioKey: "audio:track-1",
};

test("embedded estimates made before absolute timestamp extraction require fresh analysis", () => {
  memory.clear();
  saveAutoSyncCorrection({
    ...scope,
    cues,
    transform: { kind: "affine", offsetSec: 0.6, ratio: 1 },
    scope: "episode",
    verified: false,
    embeddedReference: true,
  });
  assert.ok(readSavedAutoSyncCorrection(scope.mediaKey, scope.audioKey, cues));
  const key = "harbor.subtitle.autosync.v1";
  const entries = JSON.parse(memory.get(key)!);
  delete entries[0].embeddedTimingVersion;
  memory.set(key, JSON.stringify(entries));
  assert.equal(hasSavedAutoSyncCorrection(scope.mediaKey, scope.audioKey), false);
  assert.equal(readSavedAutoSyncCorrection(scope.mediaKey, scope.audioKey, cues), null);
  entries[0].embeddedReference = false;
  memory.set(key, JSON.stringify(entries));
  assert.ok(readSavedAutoSyncCorrection(scope.mediaKey, scope.audioKey, cues));
});

test("saved correction is scoped to episode, source, audio and subtitle cue identity", () => {
  memory.clear();
  const transform = { kind: "affine" as const, offsetSec: 3.866, ratio: 1 };
  const id = saveAutoSyncCorrection({
    ...scope,
    cues,
    transform,
    scope: "episode",
    verified: true,
  });
  assert.ok(id);
  assert.equal(hasSavedAutoSyncCorrection(scope.mediaKey, scope.audioKey), true);
  assert.deepEqual(
    readSavedAutoSyncCorrection(scope.mediaKey, scope.audioKey, cues)?.transform,
    transform,
  );
  assert.equal(
    readSavedAutoSyncCorrection("episode:show:S1E2:source-secret-token", scope.audioKey, cues),
    null,
  );
  assert.equal(
    readSavedAutoSyncCorrection("episode:show:S1E1:other-source", scope.audioKey, cues),
    null,
  );
  assert.equal(readSavedAutoSyncCorrection(scope.mediaKey, "audio:other-track", cues), null);
  assert.equal(
    readSavedAutoSyncCorrection(
      scope.mediaKey,
      scope.audioKey,
      cues.map((cue, i) => (i === 0 ? { ...cue, start: cue.start + 0.3 } : cue)),
    ),
    null,
  );
  assert.equal(
    readSavedAutoSyncCorrection(
      scope.mediaKey,
      scope.audioKey,
      cues.map((cue, i) => (i === 1 ? { ...cue, text: "Different subtitle release" } : cue)),
    ),
    null,
  );
  const stored = [...memory.values()].join("");
  assert.equal(stored.includes("source-secret-token"), false);
  assert.equal(stored.includes("First dialogue"), false);
  clearSavedAutoSyncCorrection(id);
  assert.equal(hasSavedAutoSyncCorrection(scope.mediaKey, scope.audioKey), false);
});

test("scene-only estimate restores near the calibrated scene but not globally", () => {
  memory.clear();
  const id = saveAutoSyncCorrection({
    ...scope,
    cues,
    transform: { kind: "affine", offsetSec: 4.0, ratio: 1 },
    scope: "scene",
    focusSec: 800,
    verified: false,
    embeddedReference: true,
  });
  assert.ok(id);
  const saved = readSavedAutoSyncCorrection(scope.mediaKey, scope.audioKey, cues);
  assert.ok(saved);
  assert.equal(saved.embeddedReference, true);
  assert.equal(saved.verified, false);
  assert.equal(shouldRestoreAutoSyncCorrection(saved!, 820), true);
  assert.equal(shouldRestoreAutoSyncCorrection(saved!, 910), false);
  assert.equal(shouldRestoreAutoSyncCorrection(saved!, 0), false);
  assert.equal(
    saveAutoSyncCorrection({
      ...scope,
      cues,
      transform: { kind: "affine", offsetSec: 1, ratio: 1 },
      scope: "scene",
      verified: false,
    }),
    null,
  );
});

test("structural corrections can be rebuilt deterministically from original cues", () => {
  memory.clear();
  const transform = { kind: "affine" as const, offsetSec: 2.5, ratio: 1.004 };
  saveAutoSyncCorrection({ ...scope, cues, transform, scope: "episode", verified: true });
  const restored = readSavedAutoSyncCorrection(scope.mediaKey, scope.audioKey, cues);
  assert.ok(restored);
  assert.deepEqual(transformCues(cues, restored!.transform), transformCues(cues, transform));
  assert.notEqual(
    subtitleCueFingerprint(transformCues(cues, transform)),
    subtitleCueFingerprint(cues),
  );
});

test("piecewise drift with an unbounded final segment survives JSON storage", () => {
  memory.clear();
  const transform = {
    kind: "piecewise" as const,
    segments: [
      { fromSec: 0, toSec: 30, offsetSec: 1, ratio: 1 },
      { fromSec: 30, toSec: Infinity, offsetSec: 2, ratio: 1.003 },
    ],
  };
  const id = saveAutoSyncCorrection({
    ...scope,
    cues,
    transform,
    scope: "episode",
    verified: true,
  });
  assert.ok(id);
  assert.ok([...memory.values()].join("").includes('"+Infinity"'));
  const restored = readSavedAutoSyncCorrection(scope.mediaKey, scope.audioKey, cues);
  assert.deepEqual(restored?.transform, transform);
  assert.deepEqual(transformCues(cues, restored!.transform), transformCues(cues, transform));
});

test("manual offset saves the baseline rather than the Auto sync composite", () => {
  const unregister = registerPlayerSubDelayMapper((metaId, composite) =>
    metaId === "manual-with-auto" ? composite - 3.866 : composite,
  );
  try {
    writePlayerPrefs("manual-with-auto", { subDelaySec: 4.866 });
    assert.ok(Math.abs((readPlayerPrefs("manual-with-auto")?.subDelaySec ?? 0) - 1) < 0.00001);
    writePlayerPrefs("different-show", { subDelaySec: 5 });
    assert.equal(readPlayerPrefs("different-show")?.subDelaySec, 5);
  } finally {
    unregister();
  }
  // Next session restores baseline 1s, then applies the saved +3.866s.
  assert.ok(
    Math.abs((readPlayerPrefs("manual-with-auto")?.subDelaySec ?? 0) + 3.866 - 4.866) < 0.00001,
  );
});

test("corrupt saved transforms are rejected without playback errors", () => {
  memory.clear();
  const id = saveAutoSyncCorrection({
    ...scope,
    cues,
    transform: { kind: "affine", offsetSec: Number.POSITIVE_INFINITY, ratio: 1 },
    scope: "episode",
    verified: true,
  });
  assert.equal(id, null);
  memory.set("harbor.subtitle.autosync.v1", "{broken-json");
  assert.equal(hasSavedAutoSyncCorrection(scope.mediaKey, scope.audioKey), false);
});
