// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import test from "node:test";
import { buildStreamIds, catalogEpisodeStreamId } from "../src/lib/streams/stream-ids.ts";

test("TMDB movies query the bare addon id before the type-scoped id", () => {
  assert.deepEqual(buildStreamIds("tmdb:movie:123", undefined, null), [
    "tmdb:123",
    "tmdb:movie:123",
  ]);
});

test("TMDB episodes query both bare and type-scoped addon ids", () => {
  const ids = buildStreamIds("tmdb:tv:456", { season: 2, episode: 3 }, "tt1234567");
  assert.deepEqual(ids.slice(0, 2), ["tmdb:456:2:3", "tmdb:tv:456:2:3"]);
  assert.ok(ids.includes("tt1234567:2:3"));
});

test("catalog-origin episode queries retain the S/E coordinates", () => {
  const id = "tmdb:326565";
  const episode = { season: 1, episode: 3 };
  assert.equal(catalogEpisodeStreamId(id, episode, buildStreamIds(id, episode, null)), "tmdb:326565:1:3");
  assert.equal(catalogEpisodeStreamId("tt44899966", { season: 2, episode: 8 }, ["tt44899966:2:8"]), "tt44899966:2:8");
  assert.equal(catalogEpisodeStreamId("tt44899966", undefined, ["tt44899966"]), "tt44899966");
});

test("catalog-origin keeps a provider's exact video ID when provided", () => {
  assert.equal(
    catalogEpisodeStreamId("tt48434821", { season: 1, episode: 1, videoId: "special:play:1" }, ["special:play:1", "tt48434821:1:1"]),
    "special:play:1",
  );
});

test("an already-bare TMDB id is not duplicated", () => {
  assert.deepEqual(buildStreamIds("tmdb:789", undefined, null), ["tmdb:789"]);
});
