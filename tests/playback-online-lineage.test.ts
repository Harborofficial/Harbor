import assert from "node:assert/strict";
import test from "node:test";
import {
  savePlayback,
  clearPlayback,
  readLastSeriesPlayback,
  streamMatchesPreferredSource,
} from "../src/lib/playback-history.ts";

const values = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  },
});
function profile(id: string) {
  values.set(
    "harbor.profiles.v1",
    JSON.stringify({ activeId: id, profiles: [{ id: "one", isPrimary: true }, { id: "two" }] }),
  );
}
const online = {
  addonId: "torrentio",
  infoHash: "aaaa1111",
  fileIdx: 2,
  url: "https://stream.example/ep4",
  title: "Example Series",
  resolution: "1080p",
  releaseGroup: "NTB",
  source: "WEB-DL",
  audioLanguages: ["English"],
  bingeGroup: "torrentio|pack-aaa",
  size: 3000000000,
};

test("downloaded playback cannot replace the remembered exact online release", () => {
  values.clear();
  profile("one");
  savePlayback("tt-example", online, 1, 4);
  savePlayback(
    "tt-example",
    { url: "C:\\Shows\\Example.S01E05.mkv", title: "Example Series" },
    1,
    5,
  );
  const preferred = readLastSeriesPlayback("tt-example");
  assert.equal(preferred?.infoHash, online.infoHash);
  assert.equal(preferred?.addonId, online.addonId);
  assert.equal(preferred?.releaseGroup, "NTB");
  assert.equal(preferred?.resolution, "1080p");
  const sameRelease = {
    infoHash: "aaaa1111",
    addonId: "torrentio",
    resolution: "1080p",
    releaseGroupNormalized: "NTB",
    source: "WEB-DL",
  };
  assert.equal(streamMatchesPreferredSource(sameRelease, preferred!), true);
  const otherRelease = {
    infoHash: "bbbb2222",
    addonId: "torrentio",
    resolution: "1080p",
    releaseGroupNormalized: "FLUX",
    source: "WEB-DL",
  };
  assert.equal(
    streamMatchesPreferredSource(otherRelease, preferred!),
    false,
    "the same addon alone is not an exact-release match",
  );
});

test("even playing a downloaded copy of the same episode preserves online lineage", () => {
  values.clear();
  profile("one");
  savePlayback("tt-example", online, 1, 4);
  savePlayback(
    "tt-example",
    { url: "file:///E:/Shows/Episode04.mp4", title: "Example Series" },
    1,
    4,
  );
  assert.equal(readLastSeriesPlayback("tt-example")?.infoHash, "aaaa1111");
});

test("a newly selected online stream replaces the remembered preference", () => {
  values.clear();
  profile("one");
  savePlayback("tt-example", online, 1, 4);
  const alternate = { ...online, infoHash: "bbbb2222", addonId: "comet", releaseGroup: "FLUX" };
  savePlayback("tt-example", alternate, 1, 6);
  savePlayback("tt-example", { url: "/mnt/movies/Episode07.mkv" }, 1, 7);
  assert.equal(readLastSeriesPlayback("tt-example")?.infoHash, alternate.infoHash);
  assert.equal(readLastSeriesPlayback("tt-example")?.releaseGroup, "FLUX");
});

test("legacy online history is usable if the standalone preference is missing", () => {
  values.clear();
  profile("one");
  savePlayback("tt-example", online, 1, 4);
  values.delete("harbor.playback-online-source.v1.one");
  savePlayback("tt-example", { url: "C:\\Shows\\Episode05.mkv" }, 1, 5);
  assert.equal(readLastSeriesPlayback("tt-example")?.infoHash, online.infoHash);
});

test("online source lineage is profile scoped, does not reuse local paths or unrelated series", () => {
  values.clear();
  profile("one");
  savePlayback("tt-example", online, 1, 4);
  savePlayback("tt-other", { url: "https://example.com/one.mkv" }, 1, 4);
  assert.equal(readLastSeriesPlayback("tt-other"), null);
  profile("two");
  assert.equal(readLastSeriesPlayback("tt-example"), null);
  savePlayback("tt-example", { ...online, infoHash: "other-profile" }, 1, 4);
  assert.equal(readLastSeriesPlayback("tt-example")?.infoHash, "other-profile");
  profile("one");
  assert.equal(readLastSeriesPlayback("tt-example")?.infoHash, online.infoHash);
});

test("marking an older episode watched cannot override the last selected online release", () => {
  values.clear();
  profile("one");
  savePlayback("tt-example", online, 1, 4);
  const latest = { ...online, infoHash: "new-source-hash", addonId: "comet", releaseGroup: "FLUX" };
  savePlayback("tt-example", latest, 1, 6);
  savePlayback("tt-example", { title: "Marked watched", parsedTitle: "Example Series" }, 1, 4);
  assert.equal(readLastSeriesPlayback("tt-example")?.infoHash, "new-source-hash");
  assert.equal(readLastSeriesPlayback("tt-example")?.releaseGroup, "FLUX");
});

test("independent source preference stores release identity, not actual episode playback", () => {
  values.clear();
  profile("one");
  savePlayback("tt-example", online, 1, 4);
  const stored = JSON.parse(values.get("harbor.playback-online-source.v1.one")!)["tt-example"];
  assert.equal(stored.infoHash, online.infoHash);
  assert.equal(stored.releaseGroup, online.releaseGroup);
  assert.equal(stored.audioLanguages[0], "English");
  assert.equal(stored.actual, undefined);
});

test("rejecting a failed selected online stream clears only its own source preference", () => {
  values.clear();
  profile("one");
  savePlayback("tt-example", online, 1, 4);
  clearPlayback("tt-example", 1, 4);
  assert.equal(readLastSeriesPlayback("tt-example"), null);
});

test("rejecting a stale episode's online stream cannot clear a newer chosen source", () => {
  values.clear();
  profile("one");
  savePlayback("tt-example", online, 1, 4);
  const latest = { ...online, addonId: "comet", infoHash: "newer-stream" };
  savePlayback("tt-example", latest, 1, 6);
  clearPlayback("tt-example", 1, 4);
  assert.equal(readLastSeriesPlayback("tt-example")?.infoHash, "newer-stream");
});
