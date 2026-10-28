import assert from "node:assert/strict";
import test from "node:test";
import {
  moveGroupItem,
  normalizeLibraryGroups,
  parseGroupListUrl,
  validGroupImage,
} from "../src/lib/library-groups.ts";
import { parseMdblistPage } from "../src/lib/providers/mdblist-lists.ts";

test("group list URLs normalize supported providers without retaining query credentials", () => {
  assert.deepEqual(
    parseGroupListUrl("https://app.trakt.tv/users/benfranklin/lists/best-mindfucks"),
    {
      source: "trakt",
      path: "users/benfranklin/lists/best-mindfucks",
      url: "https://trakt.tv/users/benfranklin/lists/best-mindfucks",
    },
  );
  assert.deepEqual(parseGroupListUrl("https://mdblist.com/lists/alice/netflix/?apikey=secret"), {
    source: "mdblist",
    path: "lists/alice/netflix",
    url: "https://mdblist.com/lists/alice/netflix",
  });
  assert.equal(parseGroupListUrl("https://trakt.tv/users/alice/lists/weekend")?.source, "trakt");
  assert.equal(parseGroupListUrl("https://trakt.tv/lists/123")?.path, "lists/123");
  for (const url of [
    "https://mdblist.com.evil.test/lists/a/b",
    "https://user:pass@trakt.tv/lists/123",
    "https://trakt.tv/movies/test",
    "https://mdblist.com/lists/invalid",
    "http://mdblist.com/lists/a/b",
  ])
    assert.equal(parseGroupListUrl(url), null);
});

test("groups preserve list references and isolate invalid persisted entries", () => {
  const groups = normalizeLibraryGroups([
    {
      id: "a",
      name: " Netflix ",
      image: "javascript:bad",
      lists: [
        { id: "list", name: " Movies ", url: "https://mdblist.com/lists/a/movies" },
        { id: "bad", name: "Bad", url: "https://other.test" },
      ],
    },
    { id: "a", name: "duplicate" },
    null,
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].name, "Netflix");
  assert.equal(groups[0].image, undefined);
  assert.equal(groups[0].lists.length, 1);
  assert.equal(groups[0].lists[0].name, "Movies");
  assert.equal(validGroupImage("https://example.com/art.webp"), true);
  assert.equal(validGroupImage("data:image/svg+xml;base64,abcd"), false);
  assert.equal(validGroupImage("https://user:pass@example.com/art.png"), false);
});

test("reordering groups and lists preserves the source arrays", () => {
  const items = [{ id: "a" }, { id: "b" }, { id: "c" }];
  assert.deepEqual(
    moveGroupItem(items, "b", -1).map((item) => item.id),
    ["b", "a", "c"],
  );
  assert.deepEqual(
    items.map((item) => item.id),
    ["a", "b", "c"],
  );
  assert.equal(moveGroupItem(items, "a", -1), items);
});

test("Home pins survive normalization and default to unpinned", () => {
  const groups = normalizeLibraryGroups([
    { id: "pinned", name: "Netflix", lists: [], pinnedToHome: true },
    { id: "normal", name: "Weekend", lists: [] },
  ]);
  assert.equal(groups[0].pinnedToHome, true);
  assert.equal(groups[1].pinnedToHome, false);
});

test("MDBList pages preserve mixed ranks, map IDs and retain pagination", () => {
  const page = parseMdblistPage({
    movies: [
      {
        id: 19995,
        title: "Avatar",
        rank: 2,
        imdb_id: "tt0499549",
        poster: "https://example.com/avatar.jpg",
      },
    ],
    shows: [{ id: 1399, title: "Game of Thrones", rank: 1 }],
    pagination: { next_cursor: "next" },
  });
  assert.deepEqual(
    page.items.map((item) => [item.id, item.type]),
    [
      ["tmdb:tv:1399", "series"],
      ["tt0499549", "movie"],
    ],
  );
  assert.equal(page.cursor, "next");
  assert.throws(() => parseMdblistPage({ error: "not found" }));
});
