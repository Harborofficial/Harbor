import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const manualWatchedSrc = read("../src/lib/manual-watched.ts");
const nuvioSyncSrc = read("../src/lib/nuvio/nuvio-sync.ts");
const detailSrc = read("../src/views/detail.tsx");
const seriesEpisodesSrc = read("../src/views/detail/series-episodes.tsx");
const cinemetaEpisodesSrc = read("../src/views/detail/cinemeta-episodes.tsx");

// In-memory mock storage
const mockStorage = new Map<string, string>();
(globalThis as unknown as Record<string, unknown>).localStorage = {
  getItem: (key: string) => mockStorage.get(key) ?? null,
  setItem: (key: string, value: string) => {
    mockStorage.set(key, String(value));
  },
  removeItem: (key: string) => {
    mockStorage.delete(key);
  },
  clear: () => {
    mockStorage.clear();
  },
  key: (i: number) => Array.from(mockStorage.keys())[i] ?? null,
  get length() {
    return mockStorage.size;
  },
} as unknown as Storage;

if (typeof globalThis.window === "undefined") {
  (globalThis as unknown as Record<string, unknown>).window = {
    dispatchEvent: () => true,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
}

import { reconcileNuvioWatchedEpisodes, manualEpisodeKeys } from "../src/lib/manual-watched";

test("reconcileNuvioWatchedEpisodes removes unflagged episodes and adds them to unwatched", () => {
  mockStorage.clear();
  const slot = 1;
  const watchedKey = `harbor.manualwatched.v1.nuvio.${slot}`;
  const unwatchedKey = `harbor.manualunwatched.v1.nuvio.${slot}`;

  // Initially, user watched S1E1, S1E2, S1E3, S1E4, S1E5 of show tt100
  const initialWatched = ["tt100|1|1", "tt100|1|2", "tt100|1|3", "tt100|1|4", "tt100|1|5"];
  mockStorage.set(watchedKey, JSON.stringify(initialWatched));

  // User on mobile unmarks S1E4 and S1E5 (server only has 1, 2, 3)
  const serverKeys = new Set(["tt100|1|1", "tt100|1|2", "tt100|1|3"]);
  reconcileNuvioWatchedEpisodes(slot, serverKeys);

  const updatedWatched = JSON.parse(mockStorage.get(watchedKey) || "[]") as string[];
  const updatedUnwatched = JSON.parse(mockStorage.get(unwatchedKey) || "[]") as string[];

  assert.ok(!updatedWatched.includes("tt100|1|4"), "S1E4 must be removed from watched");
  assert.ok(!updatedWatched.includes("tt100|1|5"), "S1E5 must be removed from watched");
  assert.ok(updatedUnwatched.includes("tt100|1|4"), "S1E4 must be placed in unwatched");
  assert.ok(updatedUnwatched.includes("tt100|1|5"), "S1E5 must be placed in unwatched");
  assert.ok(updatedWatched.includes("tt100|1|1"), "S1E1 remains watched");
  assert.ok(updatedWatched.includes("tt100|1|2"), "S1E2 remains watched");
  assert.ok(updatedWatched.includes("tt100|1|3"), "S1E3 remains watched");
});

test("manualEpisodeKeys accurately marks unflagged mobile episodes as unwatched", () => {
  mockStorage.clear();
  const slot = 1;
  mockStorage.set("harbor.account-provider", "nuvio");
  mockStorage.set(
    "harbor.nuvio.state.v1",
    JSON.stringify({
      session: { user: { id: "u1" } },
      profiles: [{ profile_index: 1 }],
      activeProfileIndex: 1,
    }),
  );

  const watchedKey = `harbor.manualwatched.v1.nuvio.${slot}`;
  const unwatchedKey = `harbor.manualunwatched.v1.nuvio.${slot}`;
  mockStorage.set(watchedKey, JSON.stringify(["tt200|1|1", "tt200|1|2"]));
  mockStorage.set(unwatchedKey, JSON.stringify(["tt200|1|3", "tt200|1|4"]));

  const keys = manualEpisodeKeys("tt200");
  assert.ok(keys.watched.has("1:1"));
  assert.ok(keys.watched.has("1:2"));
  assert.ok(keys.unwatched.has("1:3"));
  assert.ok(keys.unwatched.has("1:4"));
  assert.ok(!keys.watched.has("1:3"));
});

test("detail page reloads on nuvioWatchedTick and reconciles targetSeriesIds", () => {
  assert.match(
    detailSrc,
    /nuvioWatchedTick,\s*profileTick,\s*meta\.id/,
    "detail effect must depend on nuvioWatchedTick and profileTick to re-pull on window focus",
  );
  assert.match(
    detailSrc,
    /reconcileNuvioWatchedEpisodes\(profileIndex,\s*serverEpisodeKeys,\s*targetIds\)/,
    "detail must reconcile manual watched storage for target series",
  );
  assert.match(
    detailSrc,
    /setStremioWatched\(new Set\(watchedKeys\)\)/,
    "detail must set stremioWatched to the pruned watchedKeys",
  );
});

test("cinemeta episodes component guards sequential inferring against Nuvio mode and series episodes does not synthesize skipped episodes", () => {
  assert.doesNotMatch(
    seriesEpisodesSrc,
    /for \(let ep = 1; ep <= count; ep\+\+\) \{\s*s\.add\(`\$\{season\.seasonNumber\}:\$\{ep\}`\);/,
    "series episodes must not synthesize watched state for skipped episodes before resume point",
  );
  assert.match(
    cinemetaEpisodesSrc,
    /if \(!isNuvioProviderActive\(\)\) \{\s*for \(const v of videos\)/,
    "cinemeta episodes must guard resumeSeason inference against Nuvio mode",
  );
});

test("nuvio-sync uses resolveNextEpisodeForSeries to prevent synthetic S1E11 overflow and handles series completion", () => {
  assert.match(
    nuvioSyncSrc,
    /async function resolveNextEpisodeForSeries/,
    "nuvio-sync must define resolveNextEpisodeForSeries",
  );
  assert.match(
    nuvioSyncSrc,
    /const nextTarget = await resolveNextEpisodeForSeries\(\s*entry\.id,\s*maxInfo\.season,\s*maxInfo\.episode,\s*\);/,
    "reconcileNuvioWatched must resolve next episode through series episode metadata",
  );
  assert.match(
    nuvioSyncSrc,
    /if \(nextTarget === null\) \{\s*clearLocalCw\(entry\.id, `nuvio-\$\{profileIndex\}`\);/,
    "reconcileNuvioWatched must clear completed series when series is genuinely finished, preserving CW on undefined metadata",
  );
  assert.match(
    nuvioSyncSrc,
    /if \(!hasProgress\) \{\s*clearLocalCw\(entry\.id, `nuvio-\$\{profileIndex\}`\);/,
    "reconcileNuvioWatched must remove series from CW when all episodes are unmarked and no progress exists",
  );
});

test("reconcileNuvioWatchedEpisodes unmarks all local episodes when mobile completely unmarks target series (e.g. Tulsa King)", () => {
  mockStorage.clear();
  const slot = 1;
  const watchedKey = `harbor.manualwatched.v1.nuvio.${slot}`;
  const unwatchedKey = `harbor.manualunwatched.v1.nuvio.${slot}`;

  // Initially user watched Tulsa King (tt16358384) S1E1, S1E2, S2E1, S2E2
  mockStorage.set(
    watchedKey,
    JSON.stringify(["tt16358384|1|1", "tt16358384|1|2", "tt16358384|2|1", "tt16358384|2|2", "other|1|1"]),
  );

  // User unmarked ALL episodes of Tulsa King on Nuvio mobile:
  // serverEpisodeKeys has other items, but 0 items for Tulsa King!
  const serverKeys = new Set(["other|1|1"]);
  const targetSeriesIds = new Set(["tt16358384", "series:tt16358384"]);

  reconcileNuvioWatchedEpisodes(slot, serverKeys, targetSeriesIds);

  const updatedWatched = JSON.parse(mockStorage.get(watchedKey) || "[]") as string[];
  const updatedUnwatched = JSON.parse(mockStorage.get(unwatchedKey) || "[]") as string[];

  assert.ok(!updatedWatched.some((k) => k.startsWith("tt16358384")), "All Tulsa King episodes must be removed from watched");
  assert.ok(updatedUnwatched.includes("tt16358384|1|1"), "Tulsa King S1E1 must be in unwatched");
  assert.ok(updatedUnwatched.includes("tt16358384|2|2"), "Tulsa King S2E2 must be in unwatched");
  assert.ok(updatedWatched.includes("other|1|1"), "Other show episodes must remain watched");
});

test("detail page does not synthesize prior episodes as watched when isNuvioActiveMode is true", () => {
  assert.match(
    detailSrc,
    /if \(!isNuvioActiveMode\) \{\s*for \(let ep = 1; ep < m\.episode; ep\+\+\)/,
    "detail page must guard prior episode synthesis with if (!isNuvioActiveMode)",
  );
});

test("readCachedNuvioPlaybackItems preserves valid parsed items and does not wipe them when records/watched are empty", () => {
  const nuvioPlaybackSrc = read("../src/lib/nuvio/nuvio-playback.ts");
  assert.doesNotMatch(
    nuvioPlaybackSrc,
    /records\.length === 0 && watched\.length === 0 && parsed\.length > 0/,
    "readCachedNuvioPlaybackItems must not wipe parsed playback items",
  );
});

test("detail page applies pending watched items and only reconciles when watchedItems is not null", () => {
  const freshDetailSrc = read("../src/views/detail.tsx");
  assert.match(
    freshDetailSrc,
    /applyPendingWatchedItems\(baseWatched,\s*profileIndex\)/,
    "detail page must merge pending watched items into safeWatchedItems",
  );
  assert.match(
    freshDetailSrc,
    /if \(watchedItems !== null\) \{\s*const serverEpisodeKeys = new Set<string>\(\);[\s\S]*?reconcileNuvioWatchedEpisodes/,
    "detail page must only reconcile local episodes when server actually returned a response",
  );
});

test("useCwAdvance evaluates Nuvio Next-Up cards when animeCwEnd is timer", () => {
  const useCwAdvanceSrc = read("../src/views/home/hooks/use-cw-advance.ts");
  assert.match(
    useCwAdvanceSrc,
    /if \(i\.external === "nuvio" && i\.upNext === true\) \{[\s\S]*?if \(animeCwEnd === "timer"\) return true;\s*return false;\s*\}/,
    "useCwAdvance must include Nuvio Next-Up cards as candidates when animeCwEnd is timer",
  );
  assert.match(
    useCwAdvanceSrc,
    /if \(i\.external === "nuvio" && i\.upNext === true\) \{\s*if \(animeCwEnd === "timer" && \(!curEpInList \|\| !nextEpAired\(list, curEpInList, isAnime\)\)\) \{/,
    "useCwAdvance must attach waitingForAir when target episode is unaired",
  );
});

test("ContinueCard captures episode airDate and displays timer countdown when unaired", () => {
  const continueCardSrc = read("../src/components/continue-card.tsx");
  assert.match(
    continueCardSrc,
    /if \(found\?\.airDate\) setEpAirDate\(found\.airDate\);/,
    "ContinueCard must store episode airDate from fetched season episodes",
  );
  assert.match(
    continueCardSrc,
    /const isUnairedDate = epAirDate \? Date\.parse\(epAirDate\) > now : false;/,
    "ContinueCard must detect future airDate",
  );
  assert.match(
    continueCardSrc,
    /const isWaiting =\s*waitingForAir \|\|\s*\(isUnairedDate && \(settings\.animeCwEnd === "timer" \|\| upNext\)\);/,
    "ContinueCard must switch to waiting timer state when next episode is unaired",
  );
});

test("CW tray and localCw update next up when episodes are marked unwatched or watched", () => {
  const syncSrc = read("../src/lib/nuvio/nuvio-sync.ts");
  assert.match(
    syncSrc,
    /const localHasProgress =\s*\(entry\.positionMs \?\? 0\) > 0 &&\s*entry\.season === nextS &&\s*entry\.episode === nextE;/,
    "reconcileNuvioWatchedOnce must only treat active in-progress playback on the same target episode as local progress",
  );
  assert.match(
    syncSrc,
    /if \(entry\.season !== nextS \|\| entry\.episode !== nextE \|\| entry\.positionMs !== newPos\) \{\s*saveLocalCw\(/,
    "reconcileNuvioWatchedOnce must update localCw to nextTarget when episode marked unwatched or watched",
  );

  const playbackSrc = read("../src/lib/nuvio/nuvio-playback.ts");
  assert.match(
    playbackSrc,
    /if \(\s*manualWatchedState\(r\.content_id, r\.season, r\.episode\) === false \|\|\s*manualWatchedState\(clean, r\.season, r\.episode\) === false\s*\) \{\s*continue;\s*\}/,
    "buildNuvioPlaybackItems must ignore safeRecords for episodes explicitly marked unwatched",
  );
  assert.match(
    playbackSrc,
    /loc\.positionMs > 0 &&\s*\(loc\.season > curSeason \|\| \(loc\.season === curSeason && loc\.episode > curEpisode\)\)/,
    "buildNuvioPlaybackItems must only allow local records with active progress (positionMs > 0) to override next up",
  );

  const detailSrc = read("../src/views/detail.tsx");
  assert.match(
    detailSrc,
    /const \{ changed \} = reconcileNuvioWatchedEpisodes\(profileIndex, serverEpisodeKeys, targetIds\);\s*if \(changed\) \{\s*void reconcileNuvioWatched\(profileIndex, \{ force: true \}\);\s*\}/,
    "detail view must trigger reconcileNuvioWatched with force: true when episode watched status changes",
  );
});
