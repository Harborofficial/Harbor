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
