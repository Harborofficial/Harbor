// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import { readFileSync } from "node:fs";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import test from "node:test";
import ts from "typescript";
import type { PmdbMediaType } from "../src/lib/publicmetadb/types";
import type { LibraryItem } from "../src/lib/stremio";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

function load<T>(path: string, mocks: Record<string, unknown>): T {
  const output = ts.transpileModule(read(path), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", output)(
    (name: string) => {
      assert.ok(name in mocks, `Unexpected dependency ${name}`);
      return mocks[name];
    },
    module,
    module.exports,
  );
  return module.exports as T;
}

type ResumePoint = {
  id: string;
  tmdb_id: number;
  media_type: PmdbMediaType;
  season?: number;
  episode?: number;
  position_ms: number;
  runtime_ms: number;
  progress: number;
  created: string;
  updated: string;
};

function resumePoint(overrides: Partial<ResumePoint> = {}): ResumePoint {
  return {
    id: "rp-1",
    tmdb_id: 1396,
    media_type: "tv",
    season: 1,
    episode: 1,
    position_ms: 1_320_000,
    runtime_ms: 2_640_000,
    progress: 50,
    created: "2026-01-01T00:00:00Z",
    updated: "2026-01-02T00:00:00Z",
    ...overrides,
  };
}

function harness(
  points: ResumePoint[],
  mappings: Record<string, string | null> = {},
  options: { respond?: (page: number) => unknown } = {},
) {
  const mappingCalls: Array<{ id: number; media: PmdbMediaType }> = [];
  const resumeWrites: unknown[][] = [];
  const requestedPages: number[] = [];
  const cached = new Map<string, string | null | undefined>();

  const api = load<typeof import("../src/lib/publicmetadb/playback")>(
    "src/lib/publicmetadb/playback.ts",
    {
      "./client": {
        pmdbRequest: async (path: string) => {
          const page = Number(new URLSearchParams(path.split("?")[1] ?? "").get("page") ?? "1");
          requestedPages.push(page);
          if (options.respond) return options.respond(page);
          return {
            items: points,
            total: points.length,
            page,
            perPage: 100,
            totalPages: 1,
          };
        },
      },
      "./session": { isAuthenticated: () => true },
      "./mappings": {
        getImdbForTmdb: async (id: number, media: PmdbMediaType) => {
          mappingCalls.push({ id, media });
          return mappings[`${media}:${id}`] ?? null;
        },
      },
      "@/lib/cw-dismiss": { isCwDismissed: () => false },
      "@/lib/resume": {
        readResumeEntry: () => null,
        saveResumeMs: (...args: unknown[]) => resumeWrites.push(args),
      },
      "@/lib/providers/tmdb/tmdb-imdb-resolve": {
        tmdbImdbCached: (metaId: string) => cached.get(metaId),
      },
    },
  );

  return {
    api,
    mappingCalls,
    resumeWrites,
    requestedPages,
    cache: cached,
    async fetch(): Promise<LibraryItem[]> {
      return api.fetchPublicMetaDbPlaybackItems();
    },
    async snapshot() {
      return api.fetchPublicMetaDbPlaybackSnapshot();
    },
  };
}

test("PMDB resume ids map to IMDb and keep the TMDB id as an alias", async () => {
  const h = harness([resumePoint()], { "tv:1396": "tt3032476" });

  const items = await h.fetch();

  assert.equal(items.length, 1);
  assert.equal(items[0]._id, "tt3032476");
  assert.deepEqual(items[0].altIds, ["tmdb:tv:1396"]);
  assert.equal(items[0].state?.video_id, "tt3032476:1:1");
  assert.deepEqual(h.mappingCalls, [{ id: 1396, media: "tv" }]);
  assert.equal(h.resumeWrites[0]?.[0], "tt3032476");
});

test("an unavailable mapping keeps the TMDB item instead of dropping it", async () => {
  const h = harness([resumePoint()], { "tv:1396": null });

  const items = await h.fetch();

  assert.equal(items.length, 1);
  assert.equal(items[0]._id, "tmdb:tv:1396");
  assert.equal(items[0].altIds, undefined);
  assert.equal(items[0].state?.video_id, "tmdb:tv:1396:1:1");
});

test("multiple episodes of one show share a single mapping lookup", async () => {
  const h = harness(
    [resumePoint(), resumePoint({ id: "rp-2", episode: 2, position_ms: 1_000_000 })],
    { "tv:1396": "tt3032476" },
  );

  const items = await h.fetch();

  assert.equal(items.length, 2);
  assert.deepEqual(
    items.map((item) => item._id),
    ["tt3032476", "tt3032476"],
  );
  assert.equal(h.mappingCalls.length, 1);
});

test("a cached TMDB to IMDb mapping avoids the PMDB mapping request", async () => {
  const h = harness([resumePoint()]);
  h.cache.set("tmdb:tv:1396", "tt3032476");

  const items = await h.fetch();

  assert.equal(items[0]._id, "tt3032476");
  assert.deepEqual(h.mappingCalls, []);
});

test("a cached negative mapping keeps the TMDB id without a lookup", async () => {
  const h = harness([resumePoint()]);
  h.cache.set("tmdb:tv:1396", null);

  const items = await h.fetch();

  assert.equal(items[0]._id, "tmdb:tv:1396");
  assert.deepEqual(h.mappingCalls, []);
});

test("a single-page snapshot is complete", async () => {
  const h = harness([resumePoint()]);

  const snapshot = await h.snapshot();

  assert.equal(snapshot.complete, true);
  assert.equal(snapshot.items.length, 1);
  assert.deepEqual(h.requestedPages, [1]);
});

test("a fully walked multi-page snapshot is complete", async () => {
  const h = harness(
    [],
    {},
    {
      respond: (page) => ({
        items: [resumePoint({ id: `rp-${page}`, episode: page })],
        totalPages: 2,
      }),
    },
  );

  const snapshot = await h.snapshot();

  assert.equal(snapshot.complete, true);
  assert.equal(snapshot.items.length, 2);
  assert.deepEqual(h.requestedPages, [1, 2]);
});

test("a page-cap snapshot fails closed", async () => {
  const h = harness(
    [],
    {},
    {
      respond: (page) => ({
        items: [resumePoint({ id: `rp-${page}`, episode: page })],
        totalPages: 11,
      }),
    },
  );

  const snapshot = await h.snapshot();

  assert.equal(snapshot.complete, false);
  assert.equal(h.requestedPages.length, 10, "the walk stops at the page cap");
});

test("an early empty page makes the snapshot incomplete", async () => {
  const h = harness(
    [],
    {},
    {
      respond: (page) =>
        page === 1 ? { items: [resumePoint()], totalPages: 2 } : { items: [], totalPages: 2 },
    },
  );

  const snapshot = await h.snapshot();

  assert.equal(snapshot.complete, false);
  assert.equal(snapshot.items.length, 1);
  assert.deepEqual(h.requestedPages, [1, 2]);
});

test("a snapshot list failure rejects instead of reporting absence", async () => {
  const h = harness(
    [],
    {},
    {
      respond: () => {
        throw new Error("HTTP 404");
      },
    },
  );

  await assert.rejects(() => h.snapshot());
});

test("the deletion snapshot keeps distinct resume ids for the same episode", async () => {
  const h = harness([resumePoint({ id: "rp-1" }), resumePoint({ id: "rp-2" })]);

  const snapshot = await h.snapshot();

  assert.equal(snapshot.items.length, 2);
  assert.deepEqual(snapshot.items.map((entry) => entry.providerPlaybackIds?.publicmetadb).sort(), [
    "rp-1",
    "rp-2",
  ]);
});

test("an absent totalPages makes the snapshot incomplete", async () => {
  const h = harness([], {}, { respond: () => ({ items: [resumePoint()] }) });

  const snapshot = await h.snapshot();

  assert.equal(snapshot.complete, false);
});
