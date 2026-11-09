// @ts-expect-error Node test types are outside the browser tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are outside the browser tsconfig.
import { readFileSync } from "node:fs";
// @ts-expect-error Node test types are outside the browser tsconfig.
import test from "node:test";
import ts from "typescript";
import type { LibraryItem } from "../src/lib/stremio.ts";

function loadIdentityHelpers() {
  const code = ts.transpileModule(readFileSync("src/lib/cw-anime-identity.ts", "utf8"), {
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
      tmdbImdbCached: () => null,
      tmdbFromImdbCached: () => null,
      tmdbImdbId: async () => null,
    },
    "@/lib/publicmetadb/mappings": {
      getImdbForTmdb: async () => null,
    },
  };
  new Function("require", "module", "exports", code)(
    (name: string) => mocks[name] ?? {},
    module,
    module.exports,
  );
  return module.exports as {
    dedupeAnimeCw(items: LibraryItem[]): (LibraryItem & { cwMembers?: LibraryItem[] })[];
  };
}

const { dedupeAnimeCw } = loadIdentityHelpers();

function series(id: string, name: string, extra: Partial<LibraryItem> = {}): LibraryItem {
  return {
    _id: id,
    type: "series",
    name,
    removed: false,
    temp: false,
    _ctime: "2026-01-01T00:00:00Z",
    _mtime: "2026-01-02T00:00:00Z",
    state: {
      duration: 2_640_000,
      timeOffset: 0,
      flaggedWatched: 0,
      season: 1,
      episode: 1,
      video_id: `${id}:1:1`,
      lastWatched: "2026-01-02T00:00:00Z",
    },
    ...extra,
  };
}

function movie(id: string, name: string, extra: Partial<LibraryItem> = {}): LibraryItem {
  return {
    ...series(id, name, extra),
    type: "movie",
    state: {
      duration: 6_300_000,
      timeOffset: 1_000_000,
      flaggedWatched: 0,
      lastWatched: "2026-01-02T00:00:00Z",
      ...extra.state,
    },
  };
}

test("series aliases merge the manual playback id into the library card", () => {
  const library = series("tt12861248", "I, Sniper");
  const manual = series("tmdb:tv:124744", "I, Sniper", {
    manualWatched: true,
    altIds: ["tt12861248"],
    state: {
      ...series("tmdb:tv:124744", "I, Sniper").state!,
      flaggedWatched: 1,
    },
  });
  const merged = dedupeAnimeCw([library, manual]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0]._id, "tt12861248");
  assert.equal(merged[0].cwMembers?.length, 2);
});

test("a local playback row merges with the library row that has another id", () => {
  const local = series("tmdb:tv:1396", "Breaking Bad", {
    local: true,
    state: {
      ...series("tmdb:tv:1396", "Breaking Bad").state!,
      timeOffset: 1_000_000,
    },
  });
  const library = series("tt0903747", "Breaking Bad");
  const merged = dedupeAnimeCw([local, library]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0]._id, "tmdb:tv:1396");
});

test("a not-yet-detected anime row still merges with a detected row sharing its id", () => {
  const plain = series("tt4444444", "Anime");
  const detected = series("tt4444444", "Anime", { isAnime: true });
  const merged = dedupeAnimeCw([plain, detected]);
  assert.equal(merged.length, 1);
});

test("unrelated library rows that share a title stay separate", () => {
  const first = series("tt1111111", "The Office");
  const second = series("tt2222222", "The Office");
  assert.equal(dedupeAnimeCw([first, second]).length, 2);
});

test("a local movie merges with its library row by title", () => {
  const local = movie("tmdb:movie:361743", "Top Gun: Maverick", { local: true });
  const library = movie("tt1745960", "Top Gun: Maverick");
  const merged = dedupeAnimeCw([local, library]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0]._id, "tmdb:movie:361743");
});
