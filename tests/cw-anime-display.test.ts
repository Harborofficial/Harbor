// @ts-expect-error Node test types are outside the browser tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are outside the browser tsconfig.
import test from "node:test";
import "./_localstorage-stub.ts";
import { recordAnimeCwId } from "../src/lib/anime-cw-ids.ts";
import { providerMappedEpisode } from "../src/lib/cw-anime-episode.ts";
import { resolveCwAnimeVideo } from "../src/lib/cw-anime-video.ts";
import type { AnimeKitsuMeta } from "../src/lib/providers/anime-kitsu-addon.ts";

const PROJECT_APPLE = {
  id: "kitsu:45619:1",
  title: "PROJECT APPLE",
  season: 1,
  episode: 1,
  imdbSeason: 1,
  imdbEpisode: 13,
};
const META: AnimeKitsuMeta = {
  id: "kitsu:45619",
  type: "series",
  name: "SPY x FAMILY Part 2",
  videos: [PROJECT_APPLE],
};
const lookup = async (metaId: string) => (metaId === "kitsu:45619" ? META : null);

function item(
  _id: string,
  episode: number,
  video_id = `kitsu:45619:${episode}`,
): {
  _id: string;
  state: {
    timeOffset: number;
    duration: number;
    season: number;
    episode: number;
    video_id: string;
  };
} {
  return {
    _id,
    state: { timeOffset: 0, duration: 1, season: 1, episode, video_id },
  };
}

test("a provider season-1 mapping advances a split cour", () => {
  assert.deepEqual(
    providerMappedEpisode({ imdbSeason: 1, imdbEpisode: 13 }, { season: 1, episode: 1 }),
    { season: 1, episode: 13 },
  );
  assert.deepEqual(
    providerMappedEpisode({ imdbSeason: 1, imdbEpisode: 18 }, { season: 1, episode: 6 }),
    { season: 1, episode: 18 },
  );
});

test("first-cour and later-season mappings keep their provider coordinates", () => {
  assert.deepEqual(
    providerMappedEpisode({ imdbSeason: 1, imdbEpisode: 1 }, { season: 1, episode: 1 }),
    { season: 1, episode: 1 },
  );
  assert.deepEqual(
    providerMappedEpisode({ imdbSeason: 2, imdbEpisode: 1 }, { season: 1, episode: 1 }),
    { season: 2, episode: 1 },
  );
});

test("the provider mapping never moves behind the stored position", () => {
  assert.equal(
    providerMappedEpisode({ imdbSeason: 1, imdbEpisode: 1 }, { season: 1, episode: 13 }),
    null,
  );
});

test("specials and foreign split seasons keep their native coordinates", () => {
  assert.equal(
    providerMappedEpisode({ imdbSeason: 0, imdbEpisode: 1 }, { season: 1, episode: 1 }),
    null,
  );
  assert.equal(
    providerMappedEpisode({ imdbSeason: 1, imdbEpisode: 13 }, { season: 1, episode: 1 }, true),
    null,
  );
});

test("the resolver finds the Kitsu video for a native anime row", async () => {
  const video = await resolveCwAnimeVideo(
    item("kitsu:45619", 1),
    { season: 1, episode: 1 },
    lookup,
  );
  assert.equal(video?.title, "PROJECT APPLE");
  assert.deepEqual(providerMappedEpisode(video, { season: 1, episode: 1 }), {
    season: 1,
    episode: 13,
  });
});

test("the resolver follows a recorded catalog-to-anime mapping", async () => {
  recordAnimeCwId("tt13706018", "kitsu:45619");
  const video = await resolveCwAnimeVideo(item("tt13706018", 1), { season: 1, episode: 1 }, lookup);
  assert.equal(video?.title, "PROJECT APPLE");
});

test("the resolver falls back from the video_id to the native episode", async () => {
  const video = await resolveCwAnimeVideo(
    item("kitsu:45619", 1, "external:video"),
    { season: 1, episode: 1 },
    lookup,
  );
  assert.equal(video?.title, "PROJECT APPLE");
});

test("ordinary titles and missing native episodes never fetch anime metadata", async () => {
  let calls = 0;
  const counting = async (metaId: string) => {
    calls += 1;
    return lookup(metaId);
  };
  assert.equal(
    await resolveCwAnimeVideo(item("tt0133093", 1), { season: 1, episode: 1 }, counting),
    null,
  );
  assert.equal(await resolveCwAnimeVideo(item("kitsu:45619", 1), null, counting), null);
  assert.equal(calls, 0);
});

test("a provider S2E1 row never falls back to the base entry's S1E1", async () => {
  const row = item("kitsu:45619", 1, "tt13706018:2:1");
  row.state.season = 2;
  assert.equal(await resolveCwAnimeVideo(row, { season: 2, episode: 1 }, lookup), null);
});

test("provider episode coordinates resolve the correct entry-relative video", async () => {
  const row = item("kitsu:45619", 13, "tt13706018:1:13");
  const video = await resolveCwAnimeVideo(row, { season: 1, episode: 13 }, lookup);
  assert.equal(video?.id, PROJECT_APPLE.id);
});

test("an unmatched provider E1 cannot masquerade as a split cour's entry E1", async () => {
  const row = item("kitsu:45619", 1, "tt13706018:1:1");
  assert.equal(await resolveCwAnimeVideo(row, { season: 1, episode: 1 }, lookup), null);
});
