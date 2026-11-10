import assert from "node:assert/strict";
import test from "node:test";
import type { ScoredStream } from "../src/lib/streams/types";
import {
  hasReusableEpisodeSource,
  matchingPreDownloadStream,
  bestAvailablePreDownloadStream,
  preDownloadSourceForPlayback,
  downloadSourceRef,
} from "../src/components/player/episode-panel/pre-download-source";

const episode = { season: 1, episode: 6 };
const ref = {
  addonId: "torrentio",
  infoHash: "abcdef123456",
  resolution: "1080p",
  releaseGroup: "NTB",
  audioLanguages: ["English"],
  source: "WEB-DL",
  bingeGroup: "torrentio:pack",
};
const candidate = (value: Record<string, unknown>): ScoredStream =>
  ({
    addonId: "torrentio",
    infoHash: "abcdef123456",
    fileIdx: 6,
    resolution: "1080p",
    releaseGroupNormalized: "NTB",
    source: "WEB-DL",
    audioLanguages: ["English"],
    season: 1,
    episode: 6,
    episodeEnd: 6,
    url: "https://cdn.example/episode6.mkv",
    ...value,
  }) as unknown as ScoredStream;

test("the pre-download selector reuses the same season-pack torrent for the next file", () => {
  const next = candidate({ fileIdx: 7 });
  assert.equal(matchingPreDownloadStream([next], ref, episode), next);
});

test("next-episode release-group matching retains the exact release even with a new hash", () => {
  const sameRelease = candidate({ infoHash: "second-episode-hash", releaseGroupNormalized: "NTB" });
  assert.equal(matchingPreDownloadStream([sameRelease], ref, episode), sameRelease);
});

test("same addon alone is not sufficient to silently download a different release", () => {
  const other = candidate({
    infoHash: "different-hash",
    releaseGroupNormalized: "FLUX",
    behaviorHints: {},
  });
  assert.equal(matchingPreDownloadStream([other], { ...ref, bingeGroup: null }, episode), null);
  assert.equal(hasReusableEpisodeSource({ addonId: "torrentio", resolution: "1080p" }), false);
});

test("a matching release from the original addon outranks a cross-addon duplicate", () => {
  const alternative = candidate({ addonId: "comet", releaseGroupNormalized: "NTB" });
  const original = candidate({ addonId: "torrentio", releaseGroupNormalized: "NTB" });
  assert.equal(matchingPreDownloadStream([alternative, original], ref, episode), original);
});

test("a source for an unrelated episode or season cannot be pre-downloaded", () => {
  const wrongEp = candidate({ season: 1, episode: 5, episodeEnd: 5 });
  const wrongSeason = candidate({ season: 2, episode: 6, episodeEnd: 6 });
  assert.equal(matchingPreDownloadStream([wrongEp, wrongSeason], ref, episode), null);
});

test("the next episode can use a multi-episode span when it contains the target", () => {
  const span = candidate({ season: 1, episode: 5, episodeEnd: 6 });
  assert.equal(matchingPreDownloadStream([span], ref, episode), span);
});

test("rejects external webpage-only sources and an unmatched audio or quality", () => {
  const web = candidate({ url: undefined, externalUrl: "https://web.example/view" });
  const wrongQuality = candidate({ resolution: "4K" });
  const wrongAudio = candidate({ audioLanguages: ["Japanese"] });
  assert.equal(matchingPreDownloadStream([web, wrongQuality, wrongAudio], ref, episode), null);
});

test("offline playback prefers the release stored with its download", () => {
  const saved = {
    sourceRef: { ...ref, infoHash: "downloaded-pack" },
    torrentInfoHash: "downloaded-pack",
  };
  const previous = { ...ref, infoHash: "different-online-release", savedAt: Date.now() };
  assert.equal(
    preDownloadSourceForPlayback("C:\\Shows\\S01E05.mkv", null, saved, previous)?.infoHash,
    "downloaded-pack",
  );
});

test("offline playback falls back to the last online release, never the file path", () => {
  const remembered = { ...ref, savedAt: Date.now() };
  const chosen = preDownloadSourceForPlayback(
    "/home/user/episode5.mkv",
    undefined,
    null,
    remembered,
  );
  assert.equal(chosen?.infoHash, ref.infoHash);
  assert.equal(chosen?.addonId, "torrentio");
});

test("new offline installs without a remembered source fall back to the pipeline's best next episode", () => {
  assert.equal(preDownloadSourceForPlayback("D:\\Videos\\S01E05.mkv", null, null, null), null);
  const invalid = candidate({ season: 1, episode: 4, episodeEnd: 4 });
  const best = candidate({ infoHash: "best-episode-six" });
  assert.equal(bestAvailablePreDownloadStream([invalid, best], episode), best);
});

test("online playback takes its actual stream over stale saved or remembered preferences", () => {
  const live = { ...ref, infoHash: "current-live-hash" };
  const historical = { ...ref, infoHash: "old-hash", savedAt: Date.now() };
  assert.equal(
    preDownloadSourceForPlayback("https://cdn.example/episode5.mkv", live, null, historical)
      ?.infoHash,
    "current-live-hash",
  );
});

test("metadata recorded for a downloaded file retains the release identity", () => {
  const details = downloadSourceRef(
    candidate({
      infoHash: "source-hash",
      releaseGroupNormalized: "NTB",
      behaviorHints: { bingeGroup: "pack" },
    }),
  );
  assert.equal(details.infoHash, "source-hash");
  assert.equal(details.releaseGroup, "NTB");
  assert.equal(details.bingeGroup, "pack");
  assert.equal(details.addonId, "torrentio");
});
