import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

type Meta = { id: string; name: string; poster?: string; type: string } | null;
type Pickable = { id: string; name: string; items: Meta[] };
type Extract = {
  anilistPickable: (groups: unknown[]) => Pickable[];
  malPickable: (groups: unknown[]) => Pickable[];
};

const ANILIST_RAILS = [
  { key: "watching", title: "Watching", statuses: ["CURRENT", "REPEATING"] },
  { key: "completed", title: "Completed", statuses: ["COMPLETED"] },
];
const MAL_RAILS = [
  { key: "watching", title: "Watching", statuses: ["watching"] },
  { key: "completed", title: "Completed", statuses: ["completed"] },
];

const anilistToMeta = (entry: { media: { id: number; title: string } }): Meta => ({
  id: `anilist:${entry.media.id}`,
  name: entry.media.title,
  poster: undefined,
  type: "series",
});
const malToMeta = (anime: { id: number; title: string }): Meta => ({
  id: `mal:${anime.id}`,
  name: anime.title,
  poster: undefined,
  type: "series",
});

function load(): Extract {
  const source = readFileSync(
    new URL("../src/views/profile/my-lists-picker.tsx", import.meta.url),
    "utf8",
  );
  const tree = ts.createSourceFile("picker.tsx", source, ts.ScriptTarget.Latest, true);
  const wanted = new Set(["toItems", "anilistPickable", "malPickable"]);
  const text = tree.statements
    .filter(
      (node): node is ts.FunctionDeclaration =>
        ts.isFunctionDeclaration(node) && wanted.has(node.name?.text ?? ""),
    )
    .map((node) => node.getText(tree))
    .join("\n");
  assert.match(text, /function anilistPickable/, "anilistPickable must exist");
  assert.match(text, /function malPickable/, "malPickable must exist");
  const output = ts.transpileModule(text, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {} as Extract;
  new Function(
    "RAIL_ORDER",
    "MAL_RAIL_ORDER",
    "anilistEntryToMeta",
    "malAnimeToMeta",
    "MAX_FEATURED_ITEMS",
    "exports",
    `${output}\nexports.anilistPickable = anilistPickable;\nexports.malPickable = malPickable;`,
  )(ANILIST_RAILS, MAL_RAILS, anilistToMeta, malToMeta, 24, exports);
  return exports;
}

const { anilistPickable, malPickable } = load();
const entry = (id: number, isPrivate = false) => ({
  private: isPrivate,
  media: { id, title: `Anime ${id}` },
});

test("AniList status groups merge, keep custom lists, and skip private entries", () => {
  const lists = anilistPickable([
    { status: "CURRENT", isCustomList: false, entries: [entry(1), entry(2, true)] },
    { status: "REPEATING", isCustomList: false, entries: [entry(3), entry(5, true)] },
    { status: null, name: "Favorites", isCustomList: true, entries: [entry(4)] },
    { status: null, name: "Empty", isCustomList: true, entries: [] },
  ]);
  assert.deepEqual(
    lists.map((list) => list.name),
    ["AniList · Watching", "AniList · Rewatching", "AniList · Favorites"],
  );
  assert.deepEqual(
    lists[0].items.map((item) => item?.id),
    ["anilist:1", "anilist:3"],
  );
  assert.deepEqual(
    lists[1].items.map((item) => item?.id),
    ["anilist:3"],
  );
});

test("MyAnimeList groups become prefixed featured lists", () => {
  const lists = malPickable([
    { status: "watching", entries: [{ anime: { id: 7, title: "Show" }, isRewatching: true }] },
    { status: "completed", entries: [{ anime: { id: 8, title: "Done" } }] },
    { status: "dropped", entries: [{ anime: { id: 9, title: "Dropped" } }] },
  ]);
  assert.deepEqual(
    lists.map((list) => list.name),
    ["MyAnimeList · Watching", "MyAnimeList · Completed", "MyAnimeList · Rewatching"],
  );
  assert.deepEqual(
    lists[1].items.map((item) => item?.id),
    ["mal:8"],
  );
  assert.deepEqual(
    lists[2].items.map((item) => item?.id),
    ["mal:7"],
  );
});
