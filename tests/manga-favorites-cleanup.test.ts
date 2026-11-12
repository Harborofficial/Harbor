import assert from "node:assert/strict";
import test from "node:test";
import { dedupeMangaFavorites, type FavoriteEntry } from "../src/lib/manga/favorites-cleanup.ts";

const live = new Set(["live-source", "other-live"]);

const entry = (patch: Partial<FavoriteEntry> & { id: string; title: string }): FavoriteEntry => ({
  addedAt: 0,
  ...patch,
});

test("collapses same-title entries with the same cover and keeps the live source", () => {
  const out = dedupeMangaFavorites(
    [
      entry({
        id: "gone::one-piece",
        sourceId: "gone",
        title: "One Piece",
        cover: "https://cdn.test/one-piece.jpg",
        addedAt: 9,
      }),
      entry({
        id: "live-source::one-piece",
        sourceId: "live-source",
        title: "One Piece",
        cover: "https://cdn.test/one-piece.jpg",
        addedAt: 1,
      }),
    ],
    live,
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].id, "live-source::one-piece");
});

test("collapses same-title entries with a matching alt title and fills a missing cover", () => {
  const out = dedupeMangaFavorites(
    [
      entry({
        id: "live-source::x",
        sourceId: "live-source",
        title: "X",
        altTitle: "エックス",
        addedAt: 1,
      }),
      entry({
        id: "other-live::x",
        sourceId: "other-live",
        title: "X",
        altTitle: "エックス",
        cover: "cover.jpg",
        addedAt: 5,
      }),
    ],
    live,
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].addedAt, 5);
  assert.equal(out[0].cover, "cover.jpg");
});

test("collapses raw and qualified ids from the same source", () => {
  const out = dedupeMangaFavorites(
    [
      entry({ id: "live-source::y", sourceId: "live-source", title: "Y", addedAt: 1 }),
      entry({ id: "y", sourceId: "live-source", title: "Y", addedAt: 9 }),
    ],
    live,
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].addedAt, 9);
});

test("two different works with the same name stay separate", () => {
  const out = dedupeMangaFavorites(
    [
      entry({ id: "a::monster", sourceId: "gone-a", title: "Monster", cover: "a.jpg", addedAt: 1 }),
      entry({ id: "b::monster", sourceId: "gone-b", title: "Monster", cover: "b.jpg", addedAt: 2 }),
    ],
    live,
  );
  assert.equal(out.length, 2);
});

test("a same-title entry without a second identity signal is left alone", () => {
  const out = dedupeMangaFavorites(
    [
      entry({ id: "live-source::y", title: "Y", addedAt: 1 }),
      entry({ id: "gone::y", sourceId: "gone", title: "Y", addedAt: 9 }),
    ],
    live,
  );
  assert.equal(out.length, 2);
});

test("keeps different titles and untitled entries separate", () => {
  const out = dedupeMangaFavorites(
    [
      entry({ id: "a", title: "One Piece" }),
      entry({ id: "b", title: "Naruto" }),
      entry({ id: "c", title: "" }),
      entry({ id: "d", title: "" }),
    ],
    live,
  );
  assert.equal(out.length, 4);
});
