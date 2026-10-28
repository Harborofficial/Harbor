// @ts-expect-error Node test types are outside the browser tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are outside the browser tsconfig.
import test from "node:test";
import { animeUpToEpisodeSlice } from "../src/views/detail/anime-episodes/up-to-episodes.ts";
import type { KitsuEpisode } from "../src/lib/providers/kitsu.ts";

function ep(overrides: Partial<KitsuEpisode> = {}): KitsuEpisode {
  return {
    id: 1,
    number: 1,
    seasonNumber: 1,
    title: "",
    synopsis: "",
    thumbnail: null,
    airdate: "2021-10-03",
    length: null,
    ...overrides,
  };
}

function cour(
  idBase: number,
  count: number,
  sourceMetaId: string | undefined,
  absoluteStart: number,
): KitsuEpisode[] {
  return Array.from({ length: count }, (_, i) =>
    ep({
      id: idBase + i,
      number: i + 1,
      sourceMetaId,
      absoluteNumber: absoluteStart + i,
    }),
  );
}

const cour1 = cour(100, 11, "kitsu:1", 1);
const cour2 = cour(200, 12, "kitsu:2", 12);
const display = [...cour1, ...cour2];

test("up to a second-cour episode includes the whole first cour", () => {
  const slice = animeUpToEpisodeSlice(display, "kitsu:1", {
    metaId: "kitsu:2",
    season: 1,
    episode: 6,
    absoluteNumber: 17,
  });
  assert.equal(slice.length, 17);
  assert.equal(slice.at(-1)?.id, 205);
});

test("up to the last second-cour episode includes every displayed episode", () => {
  const slice = animeUpToEpisodeSlice(display, "kitsu:1", {
    metaId: "kitsu:2",
    season: 1,
    episode: 12,
    absoluteNumber: 23,
  });
  assert.equal(slice.length, 23);
  assert.equal(slice.at(-1)?.id, 211);
});

test("up to a first-cour episode does not include the second cour", () => {
  const slice = animeUpToEpisodeSlice(display, "kitsu:1", {
    metaId: "kitsu:1",
    season: 1,
    episode: 11,
    absoluteNumber: 11,
  });
  assert.equal(slice.length, 11);
  assert.equal(slice.at(-1)?.id, 110);
});

test("anchor episodes without a source entry match the opened entry", () => {
  const anchor = cour(100, 11, undefined, 1);
  const slice = animeUpToEpisodeSlice([...anchor, ...cour2], "kitsu:1", {
    season: 1,
    episode: 6,
    absoluteNumber: 6,
  });
  assert.equal(slice.length, 6);
  assert.equal(slice.at(-1)?.id, 105);
});

test("the source entry disambiguates repeated numbers without absolute data", () => {
  const slice = animeUpToEpisodeSlice(display, "kitsu:1", {
    metaId: "kitsu:2",
    season: 1,
    episode: 6,
  });
  assert.equal(slice.length, 17);
  assert.equal(slice.at(-1)?.sourceMetaId, "kitsu:2");
});

test("an episode missing from the displayed list has no up-to scope", () => {
  assert.deepEqual(
    animeUpToEpisodeSlice(display, "kitsu:1", {
      metaId: "kitsu:9",
      season: 1,
      episode: 1,
    }),
    [],
  );
});
