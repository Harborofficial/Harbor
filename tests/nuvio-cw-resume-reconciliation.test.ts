import "./_localstorage-stub.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { buildNuvioPlaybackItems } from "../src/lib/nuvio/nuvio-playback";
import { clearResume, readResumeEntry, saveResumeMs } from "../src/lib/resume";
import {
  manualWatchedState,
  resetManualWatchedCache,
  setManualWatched,
} from "../src/lib/manual-watched";
import type { NuvioWatchedItem } from "../src/lib/nuvio/nuvio-types";

const CONTENT = "tt1234567";
const ALIAS = "tt7654321";
const OWNER = "nuvio-1";
const EPISODE_MS = 3_000_000;
const PROGRESS_MS = Math.round(EPISODE_MS * 0.23);

function resetStorage(): void {
  localStorage.clear();
  resetManualWatchedCache();
  clearResume(CONTENT, 1, 10, OWNER);
}

function watched(
  season: number,
  episode: number,
  at: number,
  contentId = CONTENT,
): NuvioWatchedItem {
  return {
    profile_id: 0,
    content_id: contentId,
    content_type: "series",
    title: "You",
    season,
    episode,
    watched_at: at,
  };
}

function saveProgress(contentId: string, ms: number, pct?: number): void {
  saveResumeMs(contentId, ms, 1, 10, undefined, pct, "nuvio", OWNER, Date.now());
}

function cardFor(contentId = CONTENT) {
  return buildNuvioPlaybackItems([], 1, [watched(1, 9, Date.now() - 60_000)]).find(
    (item) => item._id === contentId,
  );
}

test("Nuvio CW: a saved S1E10 resume replaces its zero-progress Up Next card", () => {
  resetStorage();
  saveProgress(CONTENT, PROGRESS_MS, 0.23);
  const card = cardFor();
  assert.ok(card, "the series card should exist");
  assert.equal(card.state?.season, 1);
  assert.equal(card.state?.episode, 10);
  assert.equal(card.upNext, false, "a partially watched episode is not Up Next");
  assert.equal(card.state?.timeOffset, PROGRESS_MS);
  assert.equal(card.state?.duration, EPISODE_MS);
});

test("Nuvio CW: a verified alias resume reaches the canonical card", () => {
  resetStorage();
  saveProgress(ALIAS, PROGRESS_MS, 0.23);
  const card = buildNuvioPlaybackItems(
    [],
    1,
    [watched(1, 9, Date.now() - 60_000)],
    undefined,
    false,
    { [CONTENT]: ALIAS },
  ).find((item) => item._id === CONTENT || item._id === ALIAS);
  assert.ok(card, "the aliased series card should exist");
  assert.equal(card.state?.episode, 10);
  assert.equal(card.upNext, false);
  assert.equal(card.state?.timeOffset, PROGRESS_MS);
});

test("Nuvio CW: older progress for another episode never replaces the current target", () => {
  resetStorage();
  saveResumeMs(CONTENT, 2_400_000, 1, 9, undefined, 0.8, "nuvio", OWNER, Date.now() - 120_000);
  saveProgress(CONTENT, PROGRESS_MS, 0.23);
  const card = cardFor();
  assert.ok(card);
  assert.equal(card.state?.episode, 10);
  assert.equal(card.state?.timeOffset, PROGRESS_MS);
});

test("Nuvio CW: removing the target episode resume restores Up Next", () => {
  resetStorage();
  saveProgress(CONTENT, PROGRESS_MS, 0.23);
  assert.equal(cardFor()?.upNext, false);
  clearResume(CONTENT, 1, 10, OWNER);
  const card = cardFor();
  assert.ok(card);
  assert.equal(card.upNext, true);
  assert.equal(card.state?.timeOffset ?? 0, 0);
});

test("Nuvio CW: provider fetch time does not outrank the saved resume", () => {
  resetStorage();
  saveProgress(CONTENT, PROGRESS_MS, 0.23);
  const items = buildNuvioPlaybackItems(
    [
      {
        profile_id: 0,
        content_id: CONTENT,
        season: 1,
        episode: 9,
        progress_seconds: 3000,
        duration_seconds: 3000,
        updated_at: new Date(Date.now() + 60_000).toISOString(),
      },
    ],
    1,
    [],
  );
  const card = items.find((item) => item._id === CONTENT);
  assert.ok(card);
  assert.equal(card.state?.episode, 10);
  assert.equal(card.state?.timeOffset, PROGRESS_MS);
});

test("Nuvio CW: a newer manual unwatch blocks the older resume", () => {
  resetStorage();
  saveProgress(CONTENT, PROGRESS_MS, 0.23);
  if (manualWatchedState(CONTENT, 1, 10) !== false) setManualWatched(CONTENT, 1, 10, false);
  assert.equal(manualWatchedState(CONTENT, 1, 10), false);
  const card = cardFor();
  assert.ok(card);
  assert.equal(card.upNext, true);
  assert.equal(card.state?.timeOffset, 0);
});

test("Nuvio CW: a newer completion advances instead of resurrecting the resume", () => {
  resetStorage();
  saveProgress(CONTENT, PROGRESS_MS, 0.23);
  const items = buildNuvioPlaybackItems([], 1, [
    watched(1, 9, Date.now() - 120_000),
    watched(1, 10, Date.now()),
  ]);
  const card = items.find((item) => item._id === CONTENT);
  assert.ok(card);
  assert.equal(card.state?.episode, 11);
  assert.equal(card.upNext, true);
});

test("Nuvio CW: another profile's resume is ignored", () => {
  resetStorage();
  saveResumeMs(CONTENT, PROGRESS_MS, 1, 10, undefined, 0.23, "nuvio", "nuvio-2", Date.now());
  const card = cardFor();
  assert.ok(card);
  assert.equal(card.upNext, true);
  assert.equal(card.state?.timeOffset, 0);
});

test("Nuvio CW: an unrelated same-title ID is not merged by title alone", () => {
  resetStorage();
  saveProgress("tt9999999", PROGRESS_MS, 0.23);
  const card = cardFor();
  assert.ok(card);
  assert.equal(card.upNext, true);
  assert.equal(card.state?.timeOffset, 0);
});

test("Nuvio CW: a refresh after playback picks up the saved resume", () => {
  resetStorage();
  assert.equal(cardFor()?.upNext, true);
  saveProgress(CONTENT, PROGRESS_MS, 0.23);
  const card = cardFor();
  assert.ok(card);
  assert.equal(card.upNext, false);
  assert.equal(card.state?.timeOffset, PROGRESS_MS);
});

test("Nuvio CW: the playback resume entry is left unchanged", () => {
  resetStorage();
  saveProgress(CONTENT, PROGRESS_MS, 0.23);
  cardFor();
  assert.equal(readResumeEntry(CONTENT, 1, 10, OWNER)?.ms, PROGRESS_MS);
});

test("Nuvio CW: a missing percentage uses a known episode duration", () => {
  resetStorage();
  saveResumeMs(CONTENT, PROGRESS_MS, 1, 10, undefined, undefined, "nuvio", OWNER, Date.now());
  const items = buildNuvioPlaybackItems(
    [
      {
        profile_id: 0,
        content_id: CONTENT,
        progress_key: `${CONTENT}_s1e10`,
        season: 1,
        episode: 10,
        progress_seconds: 0,
        duration_seconds: EPISODE_MS / 1000,
        last_watched: Date.now() - 60_000,
        name: "You",
      },
    ],
    1,
    [watched(1, 9, Date.now() - 120_000)],
  );
  const card = items.find((item) => item._id === CONTENT);
  assert.ok(card);
  assert.equal(card.upNext, false);
  assert.equal(card.state?.timeOffset, PROGRESS_MS);
  assert.equal(card.state?.duration, EPISODE_MS);
});
