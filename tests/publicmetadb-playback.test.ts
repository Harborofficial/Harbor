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

function harness(points: ResumePoint[], mappings: Record<string, string | null> = {}) {
  const mappingCalls: Array<{ id: number; media: PmdbMediaType }> = [];
  const resumeWrites: unknown[][] = [];
  const cached = new Map<string, string | null | undefined>();

  const api = load<typeof import("../src/lib/publicmetadb/playback")>(
    "src/lib/publicmetadb/playback.ts",
    {
      "./client": {
        pmdbRequest: async () => ({
          items: points,
          total: points.length,
          page: 1,
          perPage: 100,
          totalPages: 1,
        }),
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
    cache: cached,
    async fetch(): Promise<LibraryItem[]> {
      return api.fetchPublicMetaDbPlaybackItems();
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
