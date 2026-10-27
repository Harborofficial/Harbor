import "./_localstorage-stub.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildNuvioPlaybackItems } from "../src/lib/nuvio/nuvio-playback";
import { saveLocalCw } from "../src/lib/local-cw";
import { undismissCw } from "../src/lib/cw-dismiss";
import type { NuvioWatchedItem } from "../src/lib/nuvio/nuvio-types";

const SERIES = "tt7770001";

// A show marked watched as a whole (season/episode === null) is "fully watched";
// the last episode that was actually watched is the Next Up seed.
const watchedItems: NuvioWatchedItem[] = [
  {
    profile_id: 0,
    content_id: SERIES,
    content_type: "series",
    title: "Caught Up Show",
    season: null,
    episode: null,
    watched_at: Date.now(),
  },
  {
    profile_id: 0,
    content_id: SERIES,
    content_type: "series",
    title: "Caught Up Show",
    season: 1,
    episode: 10,
    watched_at: Date.now() - 1000,
  },
];

function saveTimerEntry(episode: number) {
  saveLocalCw(
    {
      id: SERIES,
      type: "series",
      name: "Caught Up Show",
      season: 1,
      episode,
      positionMs: 0,
      durationMs: 2_640_000,
      external: "nuvio",
      t: Date.now(),
    },
    "nuvio-0",
  );
}

test("Nuvio timer mode anchors a caught-up series on its last watched episode", () => {
  undismissCw(SERIES);
  // The local entry lags behind the seed (S1E9 while S1E10 was the last watched
  // episode), so the fully-watched guard decides which card the tray sees.
  saveTimerEntry(9);

  // Hide mode: the seed card is suppressed and only the lagging local card remains.
  const hidden = buildNuvioPlaybackItems([], 0, watchedItems);
  assert.equal(hidden.length, 1);
  assert.equal(hidden[0].state?.episode, 9, "Hide mode keeps the guard: no seed card is built");

  // Timer mode: the retained card is anchored on the last watched episode so the
  // tray's advancer can resolve the real next episode / countdown instead of a
  // fabricated "seed + 1" episode.
  const kept = buildNuvioPlaybackItems([], 0, watchedItems, undefined, true);
  assert.equal(kept.length, 1, "Timer mode must retain the caught-up series card");
  assert.equal(kept[0]._id, SERIES);
  assert.equal(kept[0].type, "series");
  assert.equal(kept[0].upNext, true);
  assert.equal(kept[0].external, "nuvio");
  assert.equal(kept[0].state?.season, 1);
  assert.equal(kept[0].state?.episode, 10, "Timer card keeps the watched episode, not seed + 1");
});

test("Nuvio Next Up still advances past the seed for a fully watched series", () => {
  undismissCw(SERIES);
  // A local entry ahead of the seed always wins, in either end mode.
  saveTimerEntry(11);

  const built = buildNuvioPlaybackItems([], 0, watchedItems);
  assert.equal(built.length, 1);
  assert.equal(built[0].state?.episode, 11, "Local advancement must still win over the seed");
});

test("Nuvio reconcile only keeps caught-up local entries for the timer end mode", () => {
  const sync = readFileSync(new URL("../src/lib/nuvio/nuvio-sync.ts", import.meta.url), "utf8");
  assert.match(sync, /export function cwKeepsCaughtUpForTimer\(\): boolean/);
  assert.match(sync, /return settings\.animeCwEnd === "timer";/);
  // The caught-up local entry survives the "no next episode" prune only on timer.
  assert.match(sync, /if \(!cwKeepsCaughtUpForTimer\(\)\) \{/);
});

test("Nuvio playback forwards the end mode to the fully-watched guard", () => {
  const playback = readFileSync(
    new URL("../src/lib/nuvio/nuvio-playback.ts", import.meta.url),
    "utf8",
  );
  assert.match(playback, /keepCaughtUpForTimer = false,/);
  assert.match(playback, /if \(!keepCaughtUpForTimer\) continue;/);
  assert.match(
    playback,
    /if \(keptForTimer\) \{\s*nextSeason = seed\.season;\s*nextEpisode = seed\.episode;/,
  );
});

test("Nuvio playback tags kept-for-timer item with waitingForAir", () => {
  undismissCw(SERIES);
  saveTimerEntry(9);
  const kept = buildNuvioPlaybackItems([], 0, watchedItems, undefined, true);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].waitingForAir, true);
  assert.equal((kept[0] as Record<string, unknown>).keptForTimer, true);
});

test("useCwAdvance inspects unaired episodes and sets waitingForAir when timer mode is enabled", () => {
  const advanceSrc = readFileSync(
    new URL("../src/views/home/hooks/use-cw-advance.ts", import.meta.url),
    "utf8",
  );
  assert.match(advanceSrc, /const curEpInList = list\.find/);
  assert.match(advanceSrc, /if \(curEpInList && !nextEpAired\(list, curEpInList, isAnime\)\)/);
  assert.match(advanceSrc, /if \(animeCwEnd === "timer"\)/);
});
