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

test("MDBList list URLs support percent-encoded and unencoded international slugs", () => {
  const encoded = "https://mdblist.com/lists/jarvis-16246724/netflix-nouveaut%C3%A9s-s%C3%A9ries";
  const raw = "https://mdblist.com/lists/jarvis-16246724/netflix-nouveaut\u00e9s-s\u00e9ries";
  const expected = {
    source: "mdblist",
    path: "lists/jarvis-16246724/netflix-nouveaut%C3%A9s-s%C3%A9ries",
    url: encoded,
  };
  assert.deepEqual(parseGroupListUrl(encoded), expected);
  assert.deepEqual(parseGroupListUrl(raw), expected);
  assert.deepEqual(parseGroupListUrl(encoded + "/?apikey=not-saved"), expected);
  const persisted = normalizeLibraryGroups([
    { id: "fr", name: "French series", lists: [{ id: "1", name: "New series", url: raw }] },
  ]);
  assert.equal(persisted[0].lists[0].url, encoded);
});

test("MDBList list URL validation rejects unsafe or malformed encoded slug segments", () => {
  const base = "https://mdblist.com/lists/alice/";
  for (const slug of [
    "season%2Ffinale",
    "season%5Cfinale",
    "season%20finale",
    "season%25finale",
    "season%E9finale",
    "season%00finale",
    "%2e%2e/admin",
  ]) {
    assert.equal(parseGroupListUrl(base + slug), null, "rejected " + slug);
  }
  assert.equal(parseGroupListUrl("https://mdblist.com/lists/%2Fadmin/shows"), null);
});

test("international scripts and combining marks work for both list providers", () => {
  const slugs = [
    "fran\u00e7ais",
    "ni\u00f1os",
    "\u00fcber",
    "a\u00e7\u00e3o",
    "\u0627\u0644\u0639\u0631\u0628\u064a\u0629",
    "\u0939\u093f\u0928\u094d\u0926\u0940",
    "\u65e5\u672c\u8a9e",
    "\ud55c\uad6d\uc5b4",
    "\u4e2d\u6587",
    "\u0440\u0443\u0441\u0441\u043a\u0438\u0439",
    "\u03c3\u03b5\u03b9\u03c1\u03ad\u03c2",
    "\u0e20\u0e32\u0e29\u0e32\u0e44\u0e17\u0e22",
    "e\u0301pisodes",
  ];
  for (const slug of slugs) {
    const encoded = encodeURIComponent(slug);
    for (const [host, prefix, source] of [
      ["mdblist.com", "lists/alice/", "mdblist"],
      ["app.trakt.tv", "users/alice/lists/", "trakt"],
    ] as const) {
      const input = "https://" + host + "/" + prefix + slug;
      const parsed = parseGroupListUrl(input);
      assert.equal(parsed?.source, source, input);
      assert.equal(parsed?.path, prefix + encoded, input);
      assert.equal(
        parsed?.url,
        "https://" + (source === "trakt" ? "trakt.tv" : host) + "/" + prefix + encoded,
      );
      assert.deepEqual(parseGroupListUrl("https://" + host + "/" + prefix + encoded), parsed);
    }
  }
});

test("Trakt international list URLs normalize and preserve existing supported formats", () => {
  const raw =
    "https://app.trakt.tv/users/\u00e9quipe/lists/\u65e5\u672c\u8a9e-s\u00e9ries?token=private";
  const canonical =
    "https://trakt.tv/users/%C3%A9quipe/lists/%E6%97%A5%E6%9C%AC%E8%AA%9E-s%C3%A9ries";
  const parsed = parseGroupListUrl(raw);
  assert.deepEqual(parsed, {
    source: "trakt",
    path: "users/%C3%A9quipe/lists/%E6%97%A5%E6%9C%AC%E8%AA%9E-s%C3%A9ries",
    url: canonical,
  });
  assert.deepEqual(parseGroupListUrl(canonical), parsed);
  assert.deepEqual(parseGroupListUrl(canonical + "/"), parsed);
  assert.deepEqual(
    parseGroupListUrl(
      "https://www.trakt.tv/users/\u00e9quipe/lists/\u65e5\u672c\u8a9e-s\u00e9ries",
    ),
    parsed,
  );
  assert.equal(parseGroupListUrl("https://trakt.tv/lists/123456")?.path, "lists/123456");
  assert.equal(parseGroupListUrl("https://trakt.tv/lists/official/\u65e5\u672c\u8a9e"), null);
  assert.equal(
    normalizeLibraryGroups([
      { id: "trakt-group", name: "Lists", lists: [{ id: "list", name: "Latest", url: raw }] },
    ])[0].lists[0].url,
    canonical,
  );
});

test("Trakt rejects encoded separators, invalid UTF-8, and unsafe URL variants", () => {
  const base = "https://trakt.tv/users/alice/lists/";
  for (const slug of [
    "test%2Fother",
    "test%5Cother",
    "test%20other",
    "test%25other",
    "test%E9other",
    "test%00other",
    "test%3Fother",
    "test%23other",
    "test%3Aother",
    "film\u{1F3AC}",
  ])
    assert.equal(parseGroupListUrl(base + slug), null, "rejected " + slug);
  assert.equal(parseGroupListUrl("https://trakt.tv/users/%2Fadmin/lists/good"), null);
  assert.equal(parseGroupListUrl("https://trakt.tv.evil.invalid/users/alice/lists/show"), null);
  assert.equal(parseGroupListUrl("https://user:pass@trakt.tv/users/alice/lists/show"), null);
  assert.equal(parseGroupListUrl("http://trakt.tv/users/alice/lists/show"), null);
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
