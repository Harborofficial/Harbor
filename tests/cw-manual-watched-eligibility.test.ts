// @ts-expect-error Node test types are outside the browser tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are outside the browser tsconfig.
import { readFileSync } from "node:fs";
// @ts-expect-error Node test types are outside the browser tsconfig.
import test from "node:test";
import ts from "typescript";
import type { LibraryItem } from "../src/lib/stremio.ts";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

function load(path: string, mocks: Record<string, unknown>): any {
  const code = ts.transpileModule(read(path), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const exports = {};
  new Function("require", "exports", code)((id: string) => mocks[id] ?? {}, exports);
  return exports;
}

/** Loads `src/lib/stremio.ts` with the manual-watched store stubbed to `marked`. */
function cwApi(marked: Set<string>) {
  return load("src/lib/stremio.ts", {
    "@/lib/safe-fetch": { safeFetch: async () => ({ ok: false, status: 0, text: async () => "" }) },
    "@/lib/resume": { readResumeEntry: () => null, readResumeSource: () => undefined },
    "@/lib/active-profile-id": { isNuvioProviderActive: () => false },
    "@/lib/manual-watched": {
      manualWatchedState: (metaId: string, season: number, episode: number) =>
        marked.has(`${metaId}|${season}|${episode}`) ? true : undefined,
    },
  });
}

function series(
  state: Partial<NonNullable<LibraryItem["state"]>> = {},
  extra: Partial<LibraryItem> = {},
): LibraryItem {
  return {
    _id: "tt16358384",
    type: "series",
    name: "Tulsa King",
    removed: false,
    temp: false,
    _ctime: "2026-01-01T00:00:00Z",
    _mtime: "2026-01-02T00:00:00Z",
    state: {
      duration: 3_600_000,
      timeOffset: 0,
      flaggedWatched: 1,
      season: 4,
      episode: 4,
      video_id: "tt16358384:4:4",
      lastWatched: "2026-01-02T00:00:00Z",
      ...state,
    },
    ...extra,
  };
}

test("isCwMember keeps a series whose current episode was just marked watched", () => {
  // Marking Ep 4 watched leaves flaggedWatched=1 and timeOffset=0 on the library
  // item. It must stay a Continue Watching member so the advancer can roll over to
  // Ep 5 or draw the "airing soon" timer card for it.
  const api = cwApi(new Set(["tt16358384|4|4"]));
  assert.equal(api.isCwMember(series()), true);
});

test("isCwMember still retires a watched series that Harbor never marked", () => {
  // No manual mark and no local progress: the finished episode owns nothing in the
  // tray, so the old retirement behaviour is preserved.
  const api = cwApi(new Set());
  assert.equal(api.isCwMember(series()), false);
});

test("isCwMember keeps a manual Continue Watching card for a marked series", () => {
  const api = cwApi(new Set());
  assert.equal(api.isCwMember(series({}, { manualWatched: true })), true);
});

test("isCwMember keeps unwatched series progression and finished movies unchanged", () => {
  const api = cwApi(new Set());
  // Unwatched episode, mid-series: the original "series progression" branch.
  assert.equal(api.isCwMember(series({ flaggedWatched: 0, episode: 5 })), true);
  // In-progress movie playback.
  assert.equal(
    api.isCwMember({
      _id: "tt1",
      type: "movie",
      name: "Fixture movie",
      removed: false,
      temp: false,
      _ctime: "2026-01-01T00:00:00Z",
      _mtime: "2026-01-02T00:00:00Z",
      state: { duration: 100_000, timeOffset: 50_000, flaggedWatched: 0 },
    }),
    true,
  );
  // Finished movie stays out of Continue Watching.
  assert.equal(
    api.isCwMember({
      _id: "tt2",
      type: "movie",
      name: "Finished movie",
      removed: false,
      temp: false,
      _ctime: "2026-01-01T00:00:00Z",
      _mtime: "2026-01-02T00:00:00Z",
      state: { duration: 100_000, timeOffset: 0, flaggedWatched: 1 },
    }),
    false,
  );
});

test("stremio keeps the series progression branch the tray tests pin", () => {
  const source = read("src/lib/stremio.ts");
  assert.match(
    source,
    /i\.type === "series" &&\s*i\.state\.season != null &&\s*i\.state\.episode != null &&\s*\(i\.state\.flaggedWatched \?\? 0\) === 0/,
  );
  assert.match(
    source,
    /manualWatchedState\(i\._id, i\.state\.season, i\.state\.episode\) === true/,
  );
});
