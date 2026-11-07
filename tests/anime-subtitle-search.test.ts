import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeSubtitleSearchQuery,
  subtitleProviderQuery,
} from "../src/lib/subtitles/search-query.ts";
import { searchSubtitles } from "../src/lib/subtitles/search.ts";
import type { Addon } from "../src/lib/addons.ts";

test("absolute anime episodes remain series and IMDb providers use mapped seasonal coordinates", () => {
  const query = {
    type: "movie" as const,
    title: "Anime",
    episode: 1100,
    stremioId: "kitsu:21",
    candidateIds: ["kitsu:21:1100", "tt0388629:21:3"],
  };
  assert.equal(normalizeSubtitleSearchQuery(query).type, "series");
  const mapped = subtitleProviderQuery(query);
  assert.equal(mapped.imdbId, "tt0388629");
  assert.equal(mapped.season, 21);
  assert.equal(mapped.episode, 3);
  assert.equal(query.episode, 1100, "addon numbering must not be mutated");
});

test("split cours and specials preserve exact mapped episode coordinates without guessing", () => {
  for (const [id, season, episode] of [
    ["tt1234567:2:14", 2, 14],
    ["tt1234567:0:2", 0, 2],
  ] as const) {
    const mapped = subtitleProviderQuery({ episode: 1, candidateIds: ["kitsu:42:1", id] });
    assert.equal(mapped.season, season);
    assert.equal(mapped.episode, episode);
  }
  const ambiguous = { episode: 1, candidateIds: ["tt1234567:2:1", "tt1234567:3:1"] };
  assert.equal(subtitleProviderQuery(ambiguous).imdbId, undefined);
  const otherShow = { imdbId: "tt7654321", episode: 1, candidateIds: ["tt1234567:2:1"] };
  assert.equal(subtitleProviderQuery(otherShow).imdbId, otherShow.imdbId);
  const movie = { type: "movie" as const, imdbId: "tt1234567" };
  assert.deepEqual(subtitleProviderQuery(movie), movie);
});

test("an anime search returns IMDb provider results and retries broad addons with the mapped ID", async (t) => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    value: { location: { hostname: "example.test" } },
    configurable: true,
  });
  t.after(() => {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
  });
  const requests: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL) => {
    const url = decodeURIComponent(String(input));
    requests.push(url);
    const matched = url.includes("/subtitles/series/tt0388629:21:3");
    return new Response(
      JSON.stringify({
        subtitles: matched
          ? [
              {
                id: "found",
                url: "https://subtitle.example.test/episode.srt",
                lang: "eng",
              },
            ]
          : [],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  });
  const addon = {
    transportUrl: "https://anime-addon.example.test/manifest.json",
    manifest: {
      id: "test",
      name: "Anime subtitles",
      version: "1.0.0",
      types: ["series"],
      resources: ["subtitles"],
    },
  } as Addon;
  const results = await searchSubtitles(
    {
      type: "movie",
      episode: 1100,
      stremioId: "kitsu:21",
      candidateIds: ["kitsu:21:1100", "tt0388629:21:3"],
      title: "One Piece",
      langs: ["en"],
    },
    {
      addons: [addon],
      providers: { addons: true, opensubtitles: true, wyzie: false },
      preferredLangs: ["en"],
    },
  );
  assert.ok(results.length > 0);
  assert.ok(
    requests.some((url) => url.includes("opensubtitles-v3") && url.includes("tt0388629:21:3")),
  );
  assert.ok(requests.some((url) => url.includes("anime-addon") && url.includes("kitsu:21:1100")));
  assert.ok(requests.some((url) => url.includes("anime-addon") && url.includes("tt0388629:21:3")));
  assert.ok(
    requests.every(
      (url) => !url.includes("/subtitles/movie/") && !url.includes("tt0388629:1:1100"),
    ),
  );
});
