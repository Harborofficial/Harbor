import assert from "node:assert/strict";
import test from "node:test";
import { actualPlaybackSnapshot } from "../src/lib/player/actual-playback";
import { initialPlayerSnapshot } from "../src/lib/player/bridge";
import type { PlayerSrc } from "../src/lib/view";
import { selectedSubtitleCacheName } from "../src/lib/subtitles/selected-subtitle-cache";

const src: PlayerSrc = {
  meta: { id: "local:short", type: "movie", name: "Short video" },
  url: "C:/synthetic/short.mp4",
  title: "Short video",
  notWebReady: true,
};
const session = {
  id: "session-one",
  actor: { profileId: "one", storageProfileId: "one", accountId: null },
};
test("only decoded actual playback qualifies, including short unrecognized local video", () => {
  const base = initialPlayerSnapshot();
  assert.equal(actualPlaybackSnapshot(src, base, 3, session, 100), null);
  assert.equal(actualPlaybackSnapshot(src, { ...base, status: "playing" }, 3, session, 100), null);
  const playing = { ...base, status: "playing" as const, firstFrameReady: true, durationSec: 40 };
  const result = actualPlaybackSnapshot(src, playing, 3, session, 100);
  assert.equal(result?.positionMs, 3000);
  assert.equal(result?.src.url, src.url);
  assert.equal(result?.completed, false);
  assert.equal(actualPlaybackSnapshot({ ...src, isLive: true }, playing, 3, session, 100), null);
});

test("a proxied source retains original identity but cannot replay a stale proxy session", () => {
  const result = actualPlaybackSnapshot(
    {
      ...src,
      url: "http://127.0.0.1:1111/private-proxy",
      historyUrl: "https://synthetic.invalid/video",
      proxySessionId: "ephemeral",
      playbackTraceId: "trace",
    },
    { ...initialPlayerSnapshot(), status: "playing", firstFrameReady: true, durationSec: 400 },
    30,
    session,
    100,
  );
  assert.equal(result?.src.url, "https://synthetic.invalid/video");
  assert.equal(result?.requiresSourceRefresh, true);
  assert.equal(result?.src.proxySessionId, undefined);
  assert.equal(result?.src.playbackTraceId, undefined);
});

test("completion retains actual item and observed position without selecting Up Next", () => {
  const result = actualPlaybackSnapshot(
    { ...src, episode: { season: 2, episode: 3 } },
    { ...initialPlayerSnapshot(), status: "ended", firstFrameReady: true, durationSec: 100 },
    100,
    session,
    100,
  );
  assert.equal(result?.completed, true);
  assert.deepEqual(result?.src.episode, { season: 2, episode: 3 });
  assert.equal(result?.positionMs, 100000);
});

test("near-end progress is resumable until natural EOF, independent of watched thresholds", () => {
  const base = { ...initialPlayerSnapshot(), firstFrameReady: true, durationSec: 100 };
  for (const status of ["playing", "paused"] as const) {
    const actual = actualPlaybackSnapshot(src, { ...base, status }, 90, session, 100);
    assert.equal(actual?.completed, false);
    assert.equal(actual?.positionMs, 90000);
  }
  assert.equal(
    actualPlaybackSnapshot(src, { ...base, status: "ended" }, 40, session, 100)?.completed,
    false,
    "a truncated stream EOF is not a completed playback",
  );
});

test("an observed session includes exact subtitle intent and both delays without temporary blob references", () => {
  const playing = {
    ...initialPlayerSnapshot(),
    status: "playing" as const,
    firstFrameReady: true,
    durationSec: 400,
    subDelaySec: 1.25,
    audioDelaySec: -0.2,
    subtitleTracks: [
      {
        id: "3",
        kind: "subtitle" as const,
        label: "Arabic",
        lang: "ara",
        selected: true,
        external: true,
        url: "blob:temporary",
        originalUrl: "C:/fixture/subtitle.srt",
        localTrusted: true,
      },
    ],
  };
  const result = actualPlaybackSnapshot(src, playing, 30, session, 100);
  assert.equal(result?.subtitle?.source, "C:/fixture/subtitle.srt");
  assert.equal(JSON.stringify(result?.subtitle).includes("blob:"), false);
  assert.equal(result?.subDelaySec, 1.25);
  assert.equal(result?.audioDelaySec, -0.2);
  const off = actualPlaybackSnapshot(src, { ...playing, subtitleTracks: [] }, 30, session, 101);
  assert.deepEqual(off?.subtitle, { off: true });
});

test("an old initial subtitle override cannot replace the user's observed selection after restart", () => {
  const result = actualPlaybackSnapshot(
    { ...src, subtitlePreselect: { url: "blob:old-choice", lang: "eng" } },
    { ...initialPlayerSnapshot(), status: "playing", firstFrameReady: true, durationSec: 400 },
    20,
    session,
  );
  assert.equal(result?.src.subtitlePreselect, undefined);
  assert.deepEqual(result?.subtitle, { off: true });
});

test("EOF teardown cannot overwrite the remembered track delays with cleared native defaults", () => {
  const ended = actualPlaybackSnapshot(
    src,
    { ...initialPlayerSnapshot(), status: "ended", firstFrameReady: true, durationSec: 100 },
    100,
    session,
  );
  assert.equal(ended?.subDelaySec, undefined);
  assert.equal(ended?.audioDelaySec, undefined);
});

test("an observed external subtitle is bound to the actual release even when subtitle memory is absent", () => {
  const result = actualPlaybackSnapshot(
    { ...src, streamRef: { infoHash: "ABC", fileIdx: 4 } },
    {
      ...initialPlayerSnapshot(),
      status: "playing",
      firstFrameReady: true,
      durationSec: 100,
      subtitleTracks: [
        {
          id: "1",
          kind: "subtitle",
          selected: true,
          external: true,
          label: "Arabic",
          url: "https://fixture.invalid/a.srt",
        },
      ],
    },
    20,
    session,
  );
  assert.equal(result?.subtitle?.streamKey, "torrent:abc:4");
});

test("a later seed-track snapshot without provider IDs retains the proven cached subtitle pointer", () => {
  const source = "https://fixture.invalid/arabic.srt";
  const track = {
    id: "404",
    kind: "subtitle" as const,
    external: true,
    selected: true,
    label: "Arabic",
    lang: "ara",
    url: source,
    originalUrl: source,
  };
  const mediaKey = "local:short||";
  const streamKey = "torrent:abc:4";
  const file = selectedSubtitleCacheName(mediaKey, streamKey, { ...track, source }, "srt");
  const cached = {
    source: `C:/fixture/selected/${file}`,
    format: "srt" as const,
    streamKey,
    imported: true,
    lang: "ara",
    updatedAt: Date.now(),
  };
  const actualSrc = { ...src, streamRef: { infoHash: "ABC", fileIdx: 4 } };
  const snapshot = {
    ...initialPlayerSnapshot(),
    status: "playing" as const,
    firstFrameReady: true,
    durationSec: 100,
    subtitleTracks: [track],
  };
  assert.equal(
    actualPlaybackSnapshot(actualSrc, snapshot, 20, session, Date.now(), cached)?.subtitle?.source,
    cached.source,
  );
  assert.equal(
    actualPlaybackSnapshot(actualSrc, snapshot, 24, session, Date.now(), cached)?.subtitle?.source,
    cached.source,
  );
  assert.equal(
    actualPlaybackSnapshot(actualSrc, snapshot, 24, session, Date.now(), {
      ...cached,
      source: "C:/fixture/unrelated.srt",
    })?.subtitle?.source,
    source,
  );
});
