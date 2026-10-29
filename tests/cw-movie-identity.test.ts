// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import { readFileSync } from "node:fs";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import test from "node:test";
import ts from "typescript";
import type { LibraryItem } from "../src/lib/stremio";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

function loadIdentityHelpers(
  tmdbLookup: {
    imdbForTmdb?: (id: string) => string | null;
    tmdbForImdb?: (id: string) => string | null;
  } = {},
) {
  const code = ts.transpileModule(read("src/lib/cw-anime-identity.ts"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const module = { exports: {} as Record<string, (...args: any[]) => any> };
  const mocks: Record<string, unknown> = {
    "@/lib/anime-cw-ids": {
      getAnimeCanonicalId: () => null,
      getAnimeCwId: () => null,
      getAnilistMalAlias: () => null,
      recordAnimeCwId: () => {},
      notifyAnimeCwIds: () => {},
    },
    "@/lib/providers/tmdb/tmdb-imdb-resolve": {
      tmdbImdbCached: (id: string) => tmdbLookup.imdbForTmdb?.(id) ?? null,
      tmdbFromImdbCached: (id: string) => tmdbLookup.tmdbForImdb?.(id) ?? null,
      tmdbImdbId: async (id: string) => tmdbLookup.imdbForTmdb?.(id) ?? null,
    },
    "@/lib/publicmetadb/mappings": {
      getImdbForTmdb: async (id: number) => tmdbLookup.imdbForTmdb?.(`tmdb:movie:${id}`) ?? null,
    },
  };
  new Function("require", "module", "exports", code)(
    (name: string) => mocks[name] ?? {},
    module,
    module.exports,
  );
  return module.exports as {
    dedupeAnimeCw(items: LibraryItem[]): (LibraryItem & { cwMembers?: LibraryItem[] })[];
    warmCwAnimeIdentities(items: LibraryItem[], options?: { tmdbKey?: string }): Promise<void>;
  };
}

const helpers = loadIdentityHelpers();
const dedupeAnimeCw = helpers.dedupeAnimeCw;
const imdb = "tt1745960";
const tmdb = "tmdb:movie:361743";

function movie(id: string, date: string, extra: Partial<LibraryItem> = {}): LibraryItem {
  return {
    _id: id,
    type: "movie",
    name: "Top Gun: Maverick",
    removed: false,
    _mtime: date,
    external: id === imdb ? "publicmetadb" : undefined,
    state: {
      timeOffset: date.endsWith("25T12:00:00Z") ? 850_000 : 400_000,
      duration: 1_000_000,
      lastWatched: date,
    },
    ...extra,
  };
}

test("PMDB IMDb and library TMDB movie rows merge in either source ordering, retaining both checkpoints", () => {
  const pmdb = movie(imdb, "2026-10-25T12:00:00Z", { altIds: [tmdb] });
  const olderLibrary = movie(tmdb, "2026-10-24T12:00:00Z", { altIds: [imdb], external: undefined });
  const library = movie(tmdb, "2026-10-25T13:00:00Z", { altIds: [imdb], external: undefined });
  const olderPmdb = movie(imdb, "2026-10-24T13:00:00Z", { altIds: [tmdb] });
  for (const [input, newest, older] of [
    [[pmdb, olderLibrary], pmdb, olderLibrary],
    [[library, olderPmdb], library, olderPmdb],
  ] as const) {
    const [merged] = dedupeAnimeCw([...input]);
    assert.equal(merged._id, newest._id, "the fresher first row remains the survivor");
    assert.equal(merged.cwMembers?.length, 2);
    assert.ok(merged.cwMembers?.includes(newest));
    assert.ok(merged.cwMembers?.includes(older), "the other source checkpoint remains available");
  }
});

test("a shared alias never merges movie and series rows", () => {
  const movieRow = movie(imdb, "2026-10-25T12:00:00Z", { altIds: [tmdb] });
  const seriesRow: LibraryItem = {
    ...movieRow,
    type: "series",
    external: "trakt",
    state: { ...movieRow.state!, video_id: `${imdb}:1:1`, season: 1, episode: 1 },
  };
  assert.equal(dedupeAnimeCw([movieRow, seriesRow]).length, 2);
});

test("identical local and library movie checkpoints retain their separate sources", () => {
  const shared = movie(imdb, "2026-10-25T12:00:00Z", { external: undefined });
  const local = { ...shared, local: true };
  const [merged] = dedupeAnimeCw([shared, local]);
  assert.deepEqual(merged.cwMembers, [shared, local]);
});

test("same-title movies with unrelated IDs remain separate", () => {
  const first = movie("tt1111111", "2026-10-25T12:00:00Z");
  const second = movie("tmdb:movie:222", "2026-10-24T12:00:00Z", { external: undefined });
  assert.equal(dedupeAnimeCw([first, second]).length, 2);
});

test("anime series aliases still require verified episode identity", () => {
  const alias = "tmdb:tv:991";
  const a: LibraryItem = {
    _id: "tt4444444",
    type: "series",
    name: "Anime",
    isAnime: true,
    removed: false,
    altIds: [alias],
    state: { video_id: "tt4444444:1:2", season: 1, episode: 2, timeOffset: 300, duration: 1000 },
  };
  const b: LibraryItem = {
    ...a,
    _id: alias,
    external: "trakt",
    altIds: ["tt4444444"],
    state: { video_id: `${alias}:1:2`, season: 1, episode: 2, timeOffset: 500, duration: 1000 },
  };
  assert.equal(dedupeAnimeCw([a, b]).length, 2);
});

test("a late movie bridge joins earlier rows that were initially unrelated", () => {
  const pmdb = movie(imdb, "2026-10-25T12:00:00Z");
  const library = movie(tmdb, "2026-10-24T12:00:00Z", { external: undefined });
  const bridge = movie(imdb, "2026-10-26T12:00:00Z", { altIds: [tmdb] });
  const merged = dedupeAnimeCw([pmdb, library, bridge]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0]._id, imdb);
  assert.ok(merged[0].cwMembers?.some((member) => member._id === tmdb));
});

test("a grouped movie retains a bridge alias across a later dedupe pass", () => {
  const newestImdb = movie(imdb, "2026-10-26T12:00:00Z");
  const olderTmdbBridge = movie(tmdb, "2026-10-25T12:00:00Z", {
    altIds: [imdb],
    external: "publicmetadb",
  });
  const [grouped] = dedupeAnimeCw([newestImdb, olderTmdbBridge]);
  assert.equal(grouped._id, imdb);
  assert.equal(grouped.cwMembers?.length, 2);

  const laterTmdbCheckpoint = movie(tmdb, "2026-10-27T12:00:00Z", {
    external: "simkl",
    state: { timeOffset: 720_000, duration: 1_000_000, lastWatched: "2026-10-27T12:00:00Z" },
  });
  const [merged] = dedupeAnimeCw([grouped, laterTmdbCheckpoint]);
  assert.equal(merged._id, imdb);
  assert.equal(merged.cwMembers?.length, 3);
  assert.ok(merged.cwMembers?.includes(newestImdb));
  assert.ok(merged.cwMembers?.includes(olderTmdbBridge));
  assert.ok(merged.cwMembers?.includes(laterTmdbCheckpoint));
});

test("a cached confirmed IMDb alias joins a cold TMDB row to its movie after warming", async () => {
  const dynamicHelpers = loadIdentityHelpers({
    imdbForTmdb: (id) => (id === tmdb ? imdb : null),
  });
  const pmdb = movie(imdb, "2026-10-25T12:00:00Z");
  const library = movie(tmdb, "2026-10-24T12:00:00Z", { external: undefined });
  assert.equal(
    dynamicHelpers.dedupeAnimeCw([pmdb, library]).length,
    2,
    "cold aliases do not guess",
  );
  await dynamicHelpers.warmCwAnimeIdentities([library], { tmdbKey: "fixture-key" });
  const [merged] = dynamicHelpers.dedupeAnimeCw([pmdb, library]);
  assert.equal(merged.cwMembers?.length, 2);
});

test("movie components with conflicting IMDb aliases fail closed", () => {
  const a = movie(imdb, "2026-10-25T12:00:00Z", { altIds: [tmdb] });
  const b = movie(tmdb, "2026-10-24T12:00:00Z", {
    altIds: [imdb, "tt9999999"],
    external: undefined,
  });
  const c = movie("tt9999999", "2026-10-23T12:00:00Z", { altIds: [tmdb] });
  assert.equal(dedupeAnimeCw([a, b, c]).length, 3);
});
