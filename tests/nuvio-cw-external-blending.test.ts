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

  const mocks: Record<string, unknown> = {
    react: {},
    "@/lib/simkl/playback": { fetchSimklPlaybackItems: () => providers.simkl() },
    "@/lib/trakt/playback": { fetchTraktPlaybackItems: () => providers.trakt() },
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
    triggerEvent: (name: string, detail?: unknown) => {
      if (listeners[name]) {
        listeners[name]({ detail } as unknown);
      }
    },
  };
}

test("Nuvio native CW items preserve 'nuvio' identity and blend newer Trakt watch progression", async () => {
  const h = fixture(true, true);
  const nuvioItem = makeItem("nuvio", "tt0903747", "Breaking Bad", 1, 2, "2026-10-22T10:00:00Z", 200);
  const traktItem = makeItem("trakt", "tt0903747", "Breaking Bad", 1, 4, "2026-10-22T11:00:00Z", 800);

  h.setNuvioItems([nuvioItem]);
  h.providers.trakt = async () => [traktItem];

  await h.api.refreshExternalCw(true);

  const cw = h.api.listExternalCw();
  assert.equal(cw.length, 1, "Must collapse into exactly one card for the show");
  assert.equal(cw[0].external, "nuvio", "Native Nuvio item must retain 'nuvio' card identity");
  assert.equal(cw[0].state?.episode, 4, "Newer episode progress from Trakt must blend into Nuvio card");
  assert.equal(cw[0].state?.timeOffset, 800, "Newer timeOffset from Trakt must blend into Nuvio card");
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
