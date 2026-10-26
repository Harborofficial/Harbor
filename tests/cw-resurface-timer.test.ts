import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import ts from "typescript";

function harness(opts: {
  nextEp?: { season: number; episode: number; airDate?: string } | null;
} = {}) {
  const data = new Map<string, string>();
  const storage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => data.set(k, v),
    removeItem: (k: string) => data.delete(k),
  };
  const window = { addEventListener: () => {} };
  const cache = new Map<string, any>();
  const load = (path: string): any => {
    const full = resolve(path);
    if (cache.has(full)) return cache.get(full);
    const exports = {};
    cache.set(full, exports);
    const compiled = ts.transpileModule(readFileSync(full, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    new Function("require", "exports", "localStorage", "window", compiled)(
      (name: string) => {
        if (name.endsWith("/stremio")) {
          return {
            isCwMember: (i: any) => i.state?.timeOffset > 0,
            isAnimeCwItem: () => false,
            libraryMetaType: () => "series",
            episodeFromVideoId: (id: string) => {
              const p = id?.split(":");
              return p?.length === 3 ? { season: +p[1], episode: +p[2] } : null;
            },
          };
        }
        if (name.endsWith("/series-episodes")) {
          return {
            fetchAdjacentEpisodes: async () => ({
              next: opts.nextEp !== undefined ? opts.nextEp : { season: 1, episode: 5, airDate: "2099-01-01" },
            }),
            fetchEpisodeList: async () => [],
            nextUnwatchedAfter: () => null,
          };
        }
        if (name.endsWith("/providers/anime-mapping")) {
          return { relatedLibraryIds: async () => [] };
        }
        if (name.endsWith("/cw-dismiss")) {
          return { isCwDismissed: () => false };
        }
        if (name.endsWith("/cw-profile")) {
          return { privateCwProfileId: () => "profile-1" };
        }
        return {};
      },
      exports,
      storage,
      window,
    );
    return exports;
  };
  return { load, data };
}

test("resurfaceCandidates keeps unaired episode with waitingForAir and airDate when animeCwEnd is timer", async () => {
  const futureAir = new Date(Date.now() + 86400000).toISOString();
  const h = harness({ nextEp: { season: 1, episode: 5, airDate: futureAir } });
  const resurface = h.load("src/lib/cw-resurface.ts");

  const item = {
    _id: "tt_vision_quest",
    type: "series",
    name: "Vision Quest",
    state: {
      season: 1,
      episode: 4,
      timeOffset: 0,
      duration: 3600000,
      flaggedWatched: 1,
      lastWatched: new Date().toISOString(),
    },
  };

  const timerResult = await resurface.resurfaceCandidates(
    [item],
    new Set(),
    { tmdbKey: "", animeMode: "all", animeCwEnd: "timer" },
  );

  const candidate = timerResult.get("tt_vision_quest");
  assert.ok(candidate, "Candidate should resurface when timer mode is enabled");
  assert.equal(candidate.season, 1);
  assert.equal(candidate.episode, 5);
  assert.equal(candidate.waitingForAir, true);
  assert.equal(candidate.airDate, futureAir);
});

test("resurfaceCandidates drops unaired episode when animeCwEnd is hide", async () => {
  const futureAir = new Date(Date.now() + 86400000).toISOString();
  const h = harness({ nextEp: { season: 1, episode: 5, airDate: futureAir } });
  const resurface = h.load("src/lib/cw-resurface.ts");

  const item = {
    _id: "tt_vision_quest_hide",
    type: "series",
    name: "Vision Quest",
    state: {
      season: 1,
      episode: 4,
      timeOffset: 0,
      duration: 3600000,
      flaggedWatched: 1,
      lastWatched: new Date().toISOString(),
    },
  };

  const hideResult = await resurface.resurfaceCandidates(
    [item],
    new Set(),
    { tmdbKey: "", animeMode: "all", animeCwEnd: "hide" },
  );

  assert.equal(hideResult.get("tt_vision_quest_hide"), undefined, "Should not resurface when set to hide");
});

test("resurfaceCandidates retains caught-up series with waitingForAir when no subsequent episode exists and animeCwEnd is timer", async () => {
  const h = harness({ nextEp: null }); // Show is caught up (e.g. Tulsa King latest released ep 2 watched)
  const resurface = h.load("src/lib/cw-resurface.ts");

  const item = {
    _id: "tt_tulsa_king",
    type: "series",
    name: "Tulsa King",
    state: {
      season: 2,
      episode: 2,
      timeOffset: 0,
      duration: 3600000,
      flaggedWatched: 1,
      lastWatched: new Date().toISOString(),
    },
  };

  const timerResult = await resurface.resurfaceCandidates(
    [item],
    new Set(),
    { tmdbKey: "", animeMode: "all", animeCwEnd: "timer" },
  );

  const candidate = timerResult.get("tt_tulsa_king");
  assert.ok(candidate, "Caught up series should be retained with timer");
  assert.equal(candidate.season, 2);
  assert.equal(candidate.episode, 2);
  assert.equal(candidate.waitingForAir, true);
});

test("resurfaceCandidates drops caught-up series when hideCaughtUp is true", async () => {
  const h = harness({ nextEp: null });
  const resurface = h.load("src/lib/cw-resurface.ts");

  const item = {
    _id: "tt_tulsa_king_hide",
    type: "series",
    name: "Tulsa King",
    state: {
      season: 2,
      episode: 2,
      timeOffset: 0,
      duration: 3600000,
      flaggedWatched: 1,
      lastWatched: new Date().toISOString(),
    },
  };

  const result = await resurface.resurfaceCandidates(
    [item],
    new Set(),
    { tmdbKey: "", animeMode: "all", animeCwEnd: "timer", hideCaughtUp: true },
  );

  assert.equal(result.get("tt_tulsa_king_hide"), undefined, "Should drop caught up series when hideCaughtUp is true");
});

test("resurfaceCandidates isolates cache between timer and hide modes", async () => {
  const futureAir = new Date(Date.now() + 86400000).toISOString();
  const h = harness({ nextEp: { season: 1, episode: 5, airDate: futureAir } });
  const resurface = h.load("src/lib/cw-resurface.ts");

  const item = {
    _id: "tt_cache_test",
    type: "series",
    name: "Test Cache",
    state: {
      season: 1,
      episode: 4,
      timeOffset: 0,
      duration: 3600000,
      flaggedWatched: 1,
      lastWatched: new Date().toISOString(),
    },
  };

  // Run in timer mode -> cached as timer
  const timerRes = await resurface.resurfaceCandidates([item], new Set(), {
    tmdbKey: "",
    animeMode: "all",
    animeCwEnd: "timer",
  });
  assert.ok(timerRes.get("tt_cache_test"));
  assert.equal(timerRes.get("tt_cache_test").waitingForAir, true);

  // Run in hide mode -> must NOT return cached timer entry
  const hideRes = await resurface.resurfaceCandidates([item], new Set(), {
    tmdbKey: "",
    animeMode: "all",
    animeCwEnd: "hide",
  });
  assert.equal(hideRes.get("tt_cache_test"), undefined);
});

