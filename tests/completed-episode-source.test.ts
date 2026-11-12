import assert from "node:assert/strict";
import test from "node:test";
import type { Meta } from "../src/lib/cinemeta";
import type { PlayEpisode } from "../src/lib/view";
import type { DownloadItem } from "../src/lib/download/downloads-store";
import { completedEpisodeSource } from "../src/lib/download/completed-episode-source";

const meta = { id: "tt1234567", type: "series", name: "Sample Series" } as Meta;
const episode = { season: 2, episode: 4, name: "A New Start" } as PlayEpisode;
const done = {
  id: "download-1",
  metaId: meta.id,
  season: 2,
  episode: 4,
  status: "done",
  path: "C:\\Shows\\S02E04.mkv",
  title: meta.name,
  subtitle: "S2 · E04",
} as DownloadItem;

test("manual Play opens the completed local file rather than a stream", async () => {
  const actual = await completedEpisodeSource(
    meta,
    episode,
    { imdbId: meta.id, isAnime: false },
    async (id, s, ep) => {
      assert.deepEqual([id, s, ep], [meta.id, 2, 4]);
      return done;
    },
  );
  assert.equal(actual?.url, done.path);
  assert.equal(actual?.meta.id, meta.id);
  assert.deepEqual(actual?.episode, episode);
  assert.equal(actual?.notWebReady, true);
  assert.equal(actual?.startFromZero, undefined);
});

test("automatic next episode opens a completed local file from its beginning", async () => {
  const actual = await completedEpisodeSource(
    meta,
    episode,
    { startFromZero: true },
    async () => done,
  );
  assert.equal(actual?.url, done.path);
  assert.equal(actual?.startFromZero, true);
  assert.equal(actual?.resume, undefined);
});

test("missing, unfinished and mismatched downloads cannot hijack episode playback", async () => {
  assert.equal(await completedEpisodeSource(meta, episode, undefined, async () => null), null);
  for (const item of [
    { ...done, status: "downloading" },
    { ...done, metaId: "other-series" },
    { ...done, season: 3 },
    { ...done, episode: 5 },
  ])
    assert.equal(
      await completedEpisodeSource(meta, episode, undefined, async () => item as DownloadItem),
      null,
    );
});
