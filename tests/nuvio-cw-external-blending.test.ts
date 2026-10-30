import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import type { LibraryItem } from "../src/lib/stremio";

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

const makeItem = (
  source: "simkl" | "trakt" | "publicmetadb" | "nuvio",
  id: string,
  name: string,
  season = 1,
  episode = 1,
  lastWatched = "2026-10-22T12:00:00Z",
  timeOffset = 500,
  duration = 1000,
): LibraryItem => ({
  _id: id,
  type: "series",
  name,
  external: source,
  removed: false,
  temp: false,
  _ctime: lastWatched,
  _mtime: lastWatched,
  state: {
    lastWatched,
    timeOffset,
    duration,
    season,
    episode,
    video_id: `${id}:${season}:${episode}`,
  },
});

function fixture(initialNuvioActive = true, nuvioSignedIn = true) {
  const timers = new Map<object, { callback: () => void; delay: number }>();
  const listeners: Record<string, (e?: unknown) => void> = {};
  let nuvioItems: LibraryItem[] = [];
  const providers = {
    simkl: async (): Promise<LibraryItem[]> => [],
    trakt: async (): Promise<LibraryItem[]> => [],
    publicmetadb: async (): Promise<LibraryItem[]> => [],
    nuvio: async (): Promise<LibraryItem[]> => nuvioItems,
  };
  const connected = { simkl: true, trakt: true, publicmetadb: false };
  const sessions = { simkl: {}, trakt: {}, publicmetadb: {} };
  let isNuvioActive = initialNuvioActive;
  let isSignedIn = nuvioSignedIn;

  let traktCache: LibraryItem[] = [];
  let simklCache: LibraryItem[] = [];

  const mocks: Record<string, unknown> = {
    react: {},
    "@/lib/simkl/playback": {
      fetchSimklPlaybackItems: () => providers.simkl(),
      readCachedSimklPlaybackItems: () => simklCache,
      writeCachedSimklPlaybackItems: (_items: LibraryItem[]) => {
        simklCache = _items;
      },
    },
    "@/lib/trakt/playback": {
      fetchTraktPlaybackItems: () => providers.trakt(),
      readCachedTraktPlaybackItems: () => traktCache,
      writeCachedTraktPlaybackItems: (_items: LibraryItem[]) => {
        traktCache = _items;
      },
    },
    "@/lib/publicmetadb/playback": {
      fetchPublicMetaDbPlaybackItems: () => providers.publicmetadb(),
    },
    "@/lib/publicmetadb/session": {
      getSession: () => (connected.publicmetadb ? sessions.publicmetadb : null),
      subscribeSession: (fn: () => void) => {
        listeners.publicmetadb = fn;
      },
    },
    "@/lib/simkl/session": {
      getSession: () => (connected.simkl ? sessions.simkl : null),
      subscribeSession: (fn: () => void) => {
        listeners.simkl = fn;
      },
    },
    "@/lib/trakt/session": {
      getSession: () => (connected.trakt ? sessions.trakt : null),
      subscribeSession: (fn: () => void) => {
        listeners.trakt = fn;
      },
    },
    "@/lib/stremio": {
      episodeFromVideoId: (vid?: string) => {
        if (!vid) return null;
        const parts = vid.split(":");
        if (parts.length >= 3) {
          return { season: Number(parts[1]), episode: Number(parts[2]) };
        }
        return null;
      },
    },
    "@/lib/anime-detect": {
      detectAnimeForCw: async () => {},
    },
    "@/lib/render-cause": { noteNotify: () => {} },
    "@/lib/nuvio/nuvio-playback": {
      fetchNuvioPlaybackItems: async () => providers.nuvio(),
      readCachedNuvioPlaybackItems: () => nuvioItems,
      writeCachedNuvioPlaybackItems: (_slot: number, items: LibraryItem[]) => {
        nuvioItems = items;
      },
    },
    "@/lib/nuvio/nuvio-client": {
      isNuvioSignedIn: () => isSignedIn,
    },
    "@/lib/nuvio/nuvio-sync": {
      isNuvioProviderActive: () => isNuvioActive,
      resolveNuvioProfileIndex: () => 1,
    },
  };

  const source = readFileSync(new URL("../src/lib/feed/external-cw.ts", import.meta.url), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const api = {} as typeof import("../src/lib/feed/external-cw");

  new Function("require", "exports", "window", "setTimeout", "clearTimeout", output)(
    (id: string) => {
      assert.ok(id in mocks, id);
      return mocks[id];
    },
    api,
    {
      addEventListener: (name: string, fn: (e?: unknown) => void) => {
        listeners[name] = fn;
      },
    },
    (callback: () => void, delay: number) => {
      const token = {};
      timers.set(token, { callback, delay });
      return token;
    },
    (token: object) => timers.delete(token),
  );

  return {
    api,
    providers,
    setNuvioItems: (items: LibraryItem[]) => {
      nuvioItems = items;
    },
    setTraktCache: (items: LibraryItem[]) => {
      traktCache = items;
    },
    setSimklCache: (items: LibraryItem[]) => {
      simklCache = items;
    },
    triggerEvent: (name: string, detail?: unknown) => {
      if (listeners[name]) {
        listeners[name]({ detail } as unknown);
      }
    },
  };
}

test("Nuvio native CW items preserve 'nuvio' identity and blend newer Trakt watch progression", async () => {
  const h = fixture(true, true);
  const nuvioItem = makeItem(
    "nuvio",
    "tt0903747",
    "Breaking Bad",
    1,
    2,
    "2026-10-22T10:00:00Z",
    200,
  );
  const traktItem = makeItem(
    "trakt",
    "tt0903747",
    "Breaking Bad",
    1,
    4,
    "2026-10-22T11:00:00Z",
    800,
  );

  h.setNuvioItems([nuvioItem]);
  h.providers.trakt = async () => [traktItem];

  await h.api.refreshExternalCw(true);

  const cw = h.api.listExternalCw();
  assert.equal(cw.length, 1, "Must collapse into exactly one card for the show");
  assert.equal(cw[0].external, "nuvio", "Native Nuvio item must retain 'nuvio' card identity");
  assert.equal(
    cw[0].state?.episode,
    4,
    "Newer episode progress from Trakt must blend into Nuvio card",
  );
  assert.equal(
    cw[0].state?.timeOffset,
    800,
    "Newer timeOffset from Trakt must blend into Nuvio card",
  );
});

test("Nuvio progress push does not wipe Trakt and Simkl items from externalCw", async () => {
  const h = fixture(true, true);
  const traktShow = makeItem("trakt", "tt11280740", "Severance", 2, 1, "2026-10-22T10:00:00Z");
  const simklShow = makeItem("simkl", "tt2085059", "Black Mirror", 3, 1, "2026-10-22T09:00:00Z");

  h.providers.trakt = async () => [traktShow];
  h.providers.simkl = async () => [simklShow];
  h.setNuvioItems([]);

  await h.api.refreshExternalCw(true);
  assert.equal(h.api.listExternalCw().length, 2);

  // Now user watches a show on Nuvio
  const nuvioShow = makeItem("nuvio", "tt0903747", "Breaking Bad", 1, 3, "2026-10-22T12:00:00Z");
  h.setNuvioItems([nuvioShow]);
  h.triggerEvent("harbor:nuvio-progress-pushed", { profileIndex: 1 });

  const cwAfterPush = h.api.listExternalCw();
  const ids = new Set(cwAfterPush.map((i) => i._id));
  assert.ok(ids.has("tt0903747"), "Nuvio show must be present");
  assert.ok(ids.has("tt11280740"), "Trakt show must NOT be wiped by Nuvio progress push");
  assert.ok(ids.has("tt2085059"), "Simkl show must NOT be wiped by Nuvio progress push");
});

test("Shows from Trakt and Simkl deduplicate without duplicate cards", async () => {
  const h = fixture(true, true);
  const traktShow = makeItem("trakt", "tt11280740", "Severance", 2, 2, "2026-10-22T11:00:00Z");
  const simklShow = makeItem("simkl", "tt11280740", "Severance", 2, 1, "2026-10-22T09:00:00Z");

  h.providers.trakt = async () => [traktShow];
  h.providers.simkl = async () => [simklShow];
  h.setNuvioItems([]);

  await h.api.refreshExternalCw(true);

  const cw = h.api.listExternalCw();
  assert.equal(cw.length, 1, "Only one card should exist for the same show");
  assert.equal(cw[0].external, "trakt", "Newer tracker activity wins card source");
  assert.equal(cw[0].state?.episode, 2);
});

test("Toggling Trakt progress ON restores cached cards synchronously and instantly", () => {
  const h = fixture(true, true);
  const cachedTrakt = makeItem("trakt", "tt11280740", "Severance", 2, 2, "2026-10-22T11:00:00Z");
  h.setTraktCache([cachedTrakt]);

  // Disable trakt first
  h.api.setExternalCwSources({ trakt: false, simkl: false, nuvio: true });
  assert.equal(h.api.listExternalCw().length, 0);

  // Now enable trakt - should be synchronous and instant from cache
  h.api.setExternalCwSources({ trakt: true, simkl: false, nuvio: true });
  const cw = h.api.listExternalCw();
  assert.equal(
    cw.length,
    1,
    "Cached Trakt card must appear synchronously without waiting for network",
  );
  assert.equal(cw[0]._id, "tt11280740");
  assert.equal(cw[0].external, "trakt");
});

test("Toggling Trakt progress OFF immediately drops cards synchronously", () => {
  const h = fixture(true, true);
  const cachedTrakt = makeItem("trakt", "tt11280740", "Severance", 2, 2, "2026-10-22T11:00:00Z");
  const nuvioShow = makeItem("nuvio", "tt0903747", "Breaking Bad", 1, 3, "2026-10-22T12:00:00Z");

  h.setNuvioItems([nuvioShow]);
  h.setTraktCache([cachedTrakt]);

  h.api.setExternalCwSources({ trakt: true, simkl: false, nuvio: true });
  assert.equal(h.api.listExternalCw().length, 2);

  // Toggle off Trakt
  h.api.setExternalCwSources({ trakt: false, simkl: false, nuvio: true });
  const cw = h.api.listExternalCw();
  assert.equal(cw.length, 1, "Trakt card must vanish immediately");
  assert.equal(cw[0]._id, "tt0903747", "Nuvio card must be preserved");
});

test("Simkl and Trakt in Nuvio mode exclude finished items while supporting in-progress and next up", async () => {
  const h = fixture(true, true);
  // Stale unstarted Simkl show without upNext (timeOffset: 0, upNext: false)
  const unstartedSimkl = {
    ...makeItem("simkl", "tt001", "Unstarted Simkl", 1, 1, "2026-10-22T12:00:00Z", 0, 1000),
    upNext: false,
  };
  // Finished Simkl show (timeOffset: 950 / 1000 = 95%)
  const finishedSimkl = makeItem(
    "simkl",
    "tt002",
    "Finished Simkl",
    1,
    1,
    "2026-10-22T12:00:00Z",
    950,
    1000,
  );
  // Valid in-progress Simkl show (timeOffset: 400 / 1000 = 40%)
  const inProgressSimkl = makeItem(
    "simkl",
    "tt003",
    "In-Progress Simkl",
    1,
    1,
    "2026-10-22T12:00:00Z",
    400,
    1000,
  );
  // Simkl Next Up ongoing series (timeOffset: 0, upNext: true)
  const simklNextUp = {
    ...makeItem("simkl", "tt005", "Simkl Next Up", 2, 1, "2026-10-22T12:00:00Z", 0, 1000),
    upNext: true,
  };
  // Nuvio native Next Up show (timeOffset: 0, upNext: true)
  const nuvioNextUp = {
    ...makeItem("nuvio", "tt004", "Nuvio Next Up", 1, 2, "2026-10-22T12:00:00Z", 0, 1000),
    upNext: true,
  };

  h.providers.simkl = async () => [unstartedSimkl, finishedSimkl, inProgressSimkl, simklNextUp];
  h.setNuvioItems([nuvioNextUp]);

  h.api.setExternalCwSources({ trakt: false, simkl: true, nuvio: true });
  await h.api.refreshExternalCw(true);

  const cw = h.api.listExternalCw();
  const ids = new Set(cw.map((i) => i._id));
  assert.ok(ids.has("tt004"), "Nuvio native next up card must be preserved");
  assert.ok(ids.has("tt003"), "In-progress Simkl card must be present");
  assert.ok(ids.has("tt005"), "Simkl next up card must be present");
  assert.ok(!ids.has("tt001"), "Unstarted non-upNext Simkl item must NOT enter Continue Watching");
  assert.ok(!ids.has("tt002"), "Finished Simkl item must NOT enter Continue Watching");
});
