// @ts-expect-error Node test types are outside the browser tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are outside the browser tsconfig.
import { readFileSync } from "node:fs";
// @ts-expect-error Node test types are outside the browser tsconfig.
import test from "node:test";
import ts from "typescript";

function load(path: string, mocks: Record<string, unknown>) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports: Record<string, any> = {};
  new Function("require", "exports", compiled)((id: string) => {
    assert.ok(id in mocks, `Unexpected dependency: ${id}`);
    return mocks[id];
  }, exports);
  return exports;
}

const { pickTvdbImage } = load("src/lib/providers/tvdb-proxy.ts", {
  "@/lib/cache": {
    lruSet: (map: Map<unknown, unknown>, key: unknown, value: unknown) => map.set(key, value),
  },
  "@/lib/safe-fetch": { safeFetch: async () => ({ ok: false }) },
  "./anime-mapping": { kitsuToTvdb: async () => null },
  "@/lib/config/endpoints": {
    HARBOR_TVDB_BASE: "https://fixture",
    HARBOR_API_BASE: "https://fixture",
  },
});

test("a sequel-cour row never falls back to the first season's episode still", () => {
  // Black Clover S2 (kitsu 50024): the Kitsu addon labels the cour "season 1"
  // with entry-local numbers, while AniZip carries the real IMDb coordinates.
  const map = { abs171: "s2e1.jpg", s1e2: "s1e2.jpg", s1e3: "s1e3.jpg", s2e1: "s2e1.jpg" };
  const ep = { seasonNumber: 1, number: 2, absoluteNumber: 172, imdbSeason: 2, imdbEpisode: 2 };
  assert.equal(pickTvdbImage(map, ep), null);
  const aired = { ...ep, number: 1, imdbEpisode: 1, absoluteNumber: 171 };
  assert.equal(pickTvdbImage(map, aired), "s2e1.jpg");
});

test("rows without provider identity keep the entry-local season fallback", () => {
  const map = { s1e2: "s1e2.jpg" };
  assert.equal(pickTvdbImage(map, { seasonNumber: 1, number: 2 }), "s1e2.jpg");
});

test("matching provider coordinates keep the entry-local fallback usable", () => {
  const map = { s1e2: "s1e2.jpg" };
  const ep = { seasonNumber: 1, number: 2, imdbSeason: 1, imdbEpisode: 2 };
  assert.equal(pickTvdbImage(map, ep), "s1e2.jpg");
});

test("specials sharing absolute zero keep their distinct season-zero images", () => {
  const map = { abs0: "last-special.jpg", s0e1: "first-special.jpg", s0e2: "second-special.jpg" };
  for (const number of [1, 2]) {
    assert.equal(
      pickTvdbImage(map, { seasonNumber: 0, number, absoluteNumber: 0 }),
      number === 1 ? "first-special.jpg" : "second-special.jpg",
    );
  }
});

test("special artwork never falls through to a regular absolute episode", () => {
  const map = {
    abs0: "last-special.jpg",
    abs1: "pilot.jpg",
    abs11: "regular-eleven.jpg",
    s0e1: "special.jpg",
  };
  assert.equal(
    pickTvdbImage(map, { seasonNumber: 0, number: 1, absoluteNumber: 1 }),
    "special.jpg",
  );
  for (const absoluteNumber of [undefined, 0, 1, 11]) {
    assert.equal(pickTvdbImage(map, { seasonNumber: 0, number: 11, absoluteNumber }), null);
  }
});

test("mapped provider coordinates identify specials even with entry-local numbering", () => {
  const map = { abs0: "wrong.jpg", abs2: "pilot.jpg", s0e11: "special.jpg", s1e2: "entry.jpg" };
  const ep = { seasonNumber: 1, number: 2, imdbSeason: 0, imdbEpisode: 11, absoluteNumber: 0 };
  assert.equal(pickTvdbImage(map, ep), "special.jpg");
});

test("invalid absolute numbers cannot override a regular episode's exact pair", () => {
  for (const absoluteNumber of [0, -1, 1.5, NaN, Infinity]) {
    const map = { [`abs${absoluteNumber}`]: "wrong.jpg", s2e3: "correct.jpg" };
    assert.equal(
      pickTvdbImage(map, { number: 3, imdbSeason: 2, imdbEpisode: 3, absoluteNumber }),
      "correct.jpg",
    );
  }
});

test("a cour-local episode number is never used as a franchise absolute number", () => {
  assert.equal(
    pickTvdbImage(
      { abs2: "first-cour.jpg" },
      {
        seasonNumber: 1,
        number: 2,
        imdbSeason: 2,
        imdbEpisode: 2,
      },
    ),
    null,
  );
});

test("an exact provider pair takes precedence over absolute artwork", () => {
  assert.equal(
    pickTvdbImage(
      { abs172: "stale.jpg", s2e2: "exact.jpg" },
      {
        seasonNumber: 1,
        number: 2,
        absoluteNumber: 172,
        imdbSeason: 2,
        imdbEpisode: 2,
      },
    ),
    "exact.jpg",
  );
});
