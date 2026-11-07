// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import { readFileSync } from "node:fs";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import test from "node:test";
import ts from "typescript";
import { toLocalDateISO, toLocalTimeLabel } from "../src/lib/calendar-time.ts";

function loadCalendarMapper(entries: unknown[]) {
  const file = ts.createSourceFile(
    "calendar-sources.ts",
    readFileSync(new URL("../src/lib/calendar-sources.ts", import.meta.url), "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const declarations = file.statements
    .filter(
      (statement): statement is ts.FunctionDeclaration =>
        ts.isFunctionDeclaration(statement) &&
        ["pad", "inMonth", "mapDubFeedToCalendar"].includes(statement.name?.text ?? ""),
    )
    .map((statement) => statement.getText(file))
    .join("\n");
  const compiled = ts.transpileModule(declarations, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {} as Record<string, any>;
  const mockRequire = (id: string) => {
  if (id === "./providers/anime-dub-sub") {
    return { fetchDubSchedule: async () => entries };
  }
  throw new Error(`Unexpected import: ${id}`);
  };
  new Function(
    "require",
    "exports",
    "toLocalDateISO",
    "toLocalTimeLabel",
    `${compiled}\nexports.mapDubFeedToCalendar = mapDubFeedToCalendar;`,
  )(
    mockRequire,
    exports,
    toLocalDateISO,
    toLocalTimeLabel,
  );
  return exports.mapDubFeedToCalendar as (
    year: number, month: number,
  ) => Promise<Array<Record<string, any>>>;
}

test("AniSchedule v2 schedule nodes map to local calendar episodes with stable IDs", async () => {
  const nov7 = Math.floor(new Date(2026, 10, 7, 15, 0).getTime() / 1000);
  const nov8 = Math.floor(new Date(2026, 10, 8, 1, 30).getTime() / 1000);
  const entries = [
    {
      id: 700,
      idMal: 900,
      title: { romaji: "Example Anime", english: "Example Anime EN" },
      format: "TV",
      isAdult: false,
      coverImage: { extraLarge: "poster-large", medium: "poster-small" },
      bannerImage: "banner",
      airingSchedule: {
        nodes: [
          { episode: 5, airingAt: nov7 },
          { episode: 5, airingAt: nov7 },
          { episode: 6, airingAt: nov8 },
          { episode: 7, airingAt: Math.floor(new Date(2026, 11, 1).getTime() / 1000) },
        ],
      },
    },
    {
      id: 701,
      title: { romaji: "AniList only" },
      format: "TV",
      airingSchedule: { nodes: [{ episode: 2, airingAt: nov7 }] },
    },
    {
      id: 702,
      idMal: 902,
      format: "TV",
      isAdult: true,
      airingSchedule: { nodes: [{ episode: 1, airingAt: nov7 }] },
    },
    {
      id: 703,
      idMal: 903,
      format: "MOVIE",
      airingSchedule: { nodes: [{ episode: 1, airingAt: nov7 }] },
    },
  ];

  const items = await loadCalendarMapper(entries)(2026, 10);
  assert.deepEqual(items.map((item) => item.id), ["mal:900:1:5", "anilist:701:1:2", "mal:900:1:6"]);
  assert.equal(items[0].name, "Example Anime EN E05");
  assert.equal(items[0].poster, "poster-large");
  assert.equal(items[0].background, "banner");
  assert.equal(items[0].releaseDate, "2026-11-07");
  assert.equal(items[0].releaseAtMs, nov7 * 1000);
  assert.equal(items[0].releaseTime, toLocalTimeLabel(new Date(nov7 * 1000)));
});

function loadDubProvider() {
  const source = readFileSync(new URL("../src/lib/providers/anime-dub-sub.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {} as Record<string, any>;
  let mappingCalls = 0;
  const feed = [{ id: 700, idMal: 900 }];
  new Function("require", "exports", compiled)((id: string) => {
    if (id === "@/lib/safe-fetch") {
      return { safeFetch: async () => ({ ok: true, json: async () => feed }) };
    }
    if (id === "@/lib/providers/anime-mapping") {
      return {
        kitsuToMal: async () => {
          mappingCalls++;
          return 900;
        },
        kitsuToAnilist: async () => 700,
      };
    }
    throw new Error(`Unexpected import: ${id}`);
  }, exports);
  return { api: exports, mappingCalls: () => mappingCalls };
}

test("Kitsu IDs resolve through shared mappings and match both feed ID systems", async () => {
  const { api, mappingCalls } = loadDubProvider();
  api.ensureDubForAnimeId("kitsu:77");
  api.ensureDubForAnimeId("kitsu:77");
  for (let i = 0; i < 20 && !api.animeHasDub("kitsu:77"); i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.equal(api.animeHasDub("kitsu:77"), true);
  assert.equal(mappingCalls(), 1);
});

test("Poster/TV and both Big Picture DUB surfaces share the same resolution hook", () => {
  for (const path of [
    "../src/components/use-card-shared-state.ts",
    "../src/views/big-picture/bp-card-marks.tsx",
    "../src/views/big-picture/bp-anime-hero-meta.tsx",
  ]) {
    const source = readFileSync(new URL(path, import.meta.url), "utf8");
    assert.match(source, /useAnimeDub/);
  }
});
