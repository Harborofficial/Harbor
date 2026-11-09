import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { groupMediaServerTitles } from "../src/lib/media-server/selectors.ts";
import { filterMediaServerCollections } from "../src/lib/media-server/collection-search.ts";

const source = readFileSync(
  new URL("../src/lib/media-server/jellyfin-emby.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function adapterFor(request) {
  const module = { exports: {} };
  const dependencies = {
    "./connections": { mediaServerToken: () => null },
    "./transport": {
      normalizeServerOrigin: (origin) => origin,
      mediaServerRequest: request,
    },
    "./quality": {},
    "@/lib/episode-span": { parseEpisodeSpan: () => null },
  };
  new Function("require", "module", "exports", compiled)(
    (name) => {
      assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
      return dependencies[name];
    },
    module,
    module.exports,
  );
  return new module.exports.JellyfinEmbyAdapter("jellyfin", "https://jellyfin.test");
}

const connection = { id: "server", userId: "user", origin: "https://jellyfin.test" };
const library = {
  id: "library",
  connectionId: "server",
  name: "Movies",
  kind: "mixed",
  enabled: true,
};
const members = [
  { Id: "movie", Type: "Movie", Name: "Collection Movie" },
  { Id: "series", Type: "Series", Name: "Collection Show" },
];

test("collection members survive sync and remain available to title search", async () => {
  const adapter = adapterFor(async (origin, path) => {
    const params = new URL(path, origin).searchParams;
    const inCollection = params.get("ParentId") === "collection";
    // Jellyfin can replace members with a BoxSet when grouping is enabled.
    const items =
      inCollection || params.get("CollapseBoxSetItems") === "false"
        ? members
        : [{ Id: "collection", Type: "BoxSet", Name: "Collection" }];
    return { body: { Items: items, TotalRecordCount: items.length } };
  });
  const page = await adapter.synchronize(connection, library);
  const memberIds = await adapter.collectionItemIds(connection, "collection");
  const memberKeys = new Set(memberIds.map((id) => `server:${id}`));
  const titles = groupMediaServerTitles(page.items);
  assert.deepEqual(
    titles.map((title) => title.fallbackTitle),
    ["Collection Movie", "Collection Show"],
  );
  assert.equal(
    titles.filter((title) => title.itemKeys.some((key) => memberKeys.has(key))).length,
    2,
  );
  assert.equal(
    titles.filter((title) => title.fallbackTitle.toLowerCase().includes("collection movie")).length,
    1,
  );
});

test("every sync page requests individual items, including concurrent and continuation pages", async () => {
  const starts = [];
  const adapter = adapterFor(async (origin, path) => {
    const params = new URL(path, origin).searchParams;
    assert.equal(params.get("CollapseBoxSetItems"), "false");
    const start = Number(params.get("StartIndex"));
    starts.push(start);
    const size = Math.min(1000, 4001 - start);
    return {
      body: {
        Items: Array.from({ length: size }, (_, index) => ({
          Id: String(start + index),
          Type: "Movie",
          Name: `Movie ${start + index}`,
        })),
        TotalRecordCount: 4001,
      },
    };
  });
  const first = await adapter.synchronize(connection, library);
  assert.equal(first.items.length, 4000);
  assert.equal(first.cursor, "4000");
  const last = await adapter.synchronize(connection, library, first.cursor);
  assert.equal(last.items.length, 1);
  assert.equal(last.cursor, undefined);
  assert.deepEqual(
    starts.sort((a, b) => a - b),
    [0, 1000, 2000, 3000, 4000],
  );
});

test("collection membership remains ungrouped across pages", async () => {
  const adapter = adapterFor(async (origin, path) => {
    const params = new URL(path, origin).searchParams;
    assert.equal(params.get("CollapseBoxSetItems"), "false");
    assert.equal(params.get("ParentId"), "collection");
    const start = Number(params.get("StartIndex"));
    return {
      body: {
        Items: Array.from({ length: start === 0 ? 500 : 1 }, (_, index) => ({
          Id: String(start + index),
        })),
      },
    };
  });
  const ids = await adapter.collectionItemIds(connection, "collection");
  assert.equal(ids.length, 501);
  assert.equal(new Set(ids).size, 501);
});

test("collection search returns every collection containing a matching movie or series", () => {
  const collections = [
    { id: "marvel", connectionId: "server", name: "Marvel" },
    { id: "sony", connectionId: "server", name: "Sony" },
    { id: "tv", connectionId: "server", name: "TV favorites" },
    { id: "other", connectionId: "other-server", name: "Other library" },
  ];
  const members = new Map([
    ["server:marvel", new Set(["server:spider", "server:iron"])],
    ["server:sony", new Set(["server:spider"])],
    ["server:tv", new Set(["server:show"])],
    ["other-server:other", new Set(["other-server:spider"])],
  ]);
  const titles = new Map([
    ["server:spider", "Spider-Man: No Way Home"],
    ["server:iron", "iron man"],
    ["server:show", "the last of us"],
  ]);
  assert.deepEqual(
    filterMediaServerCollections(collections, "  SPIDER-MAN  ", members, titles).map((c) => c.name),
    ["Marvel", "Sony"],
  );
  assert.deepEqual(
    filterMediaServerCollections(collections, "last of us", members, titles).map((c) => c.name),
    ["TV favorites"],
  );
  assert.deepEqual(
    filterMediaServerCollections(collections, "marvel", members, titles).map((c) => c.name),
    ["Marvel"],
  );
  assert.deepEqual(filterMediaServerCollections(collections, "  ", members, titles), collections);
});
