// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import test from "node:test";
import {
  findPreferredSourceMatch,
  preferredSourceAddonPending,
  streamMatchesPreferredSource,
  streamMatchesReleaseLineage,
  streamMatchesSource,
} from "../src/lib/playback-history.ts";

test("season-pack episodes match by torrent hash when their file-specific binge groups differ", () => {
  const entry = {
    infoHash: "ABCDEF123456",
    fileIdx: 3,
    addonId: "comet",
    resolution: "1080p",
    source: "BluRay",
    bingeGroup: "comet|torbox|abcdef123456|3",
    savedAt: Date.now(),
  };
  const nextEpisode = {
    infoHash: "abcdef123456",
    fileIdx: 4,
    addonId: "comet",
    resolution: "1080p",
    source: "BluRay",
    behaviorHints: { bingeGroup: "comet|torbox|abcdef123456|4" },
  };

  assert.equal(streamMatchesSource(nextEpisode, entry), true);
});

test("different known torrent hashes do not match through broader source metadata", () => {
  const entry = {
    infoHash: "pack-one",
    addonId: "torrentio",
    resolution: "1080p",
    source: "WEB-DL",
    bingeGroup: "shared-group",
    savedAt: Date.now(),
  };
  const differentRelease = {
    infoHash: "pack-two",
    addonId: "torrentio",
    resolution: "1080p",
    source: "WEB-DL",
    behaviorHints: { bingeGroup: "shared-group" },
  };

  assert.equal(streamMatchesSource(differentRelease, entry), false);
});

test("next episode keeps the same release group across per-episode torrents", () => {
  const entry = {
    infoHash: "episode-one-hash",
    addonId: "torrentio",
    resolution: "1080p",
    releaseGroup: "SUCCESSFULCRAB",
    source: "WEB-DL",
    savedAt: Date.now(),
  };
  const nextEpisode = {
    infoHash: "episode-two-hash",
    addonId: "torrentio",
    resolution: "1080p",
    releaseGroupNormalized: "SUCCESSFULCRAB",
    source: "WEB-DL",
  };

  assert.equal(streamMatchesSource(nextEpisode, entry), false);
  assert.equal(streamMatchesReleaseLineage(nextEpisode, entry), true);
});

test("next episode keeps the same release group when binge groups are file-specific", () => {
  const entry = {
    addonId: "comet",
    url: "https://debrid.example/episode-one",
    resolution: "1080p",
    releaseGroup: "NTB",
    source: "WEB-DL",
    bingeGroup: "comet|torbox|aaaa1111|3",
    savedAt: Date.now(),
  };
  const nextEpisode = {
    addonId: "comet",
    resolution: "1080p",
    releaseGroupNormalized: "NTB",
    source: "WEB-DL",
    behaviorHints: { bingeGroup: "comet|torbox|bbbb2222|4" },
  };

  assert.equal(streamMatchesSource(nextEpisode, entry), false);
  assert.equal(streamMatchesReleaseLineage(nextEpisode, entry), true);
});

test("next episode does not cross addons, release groups, or unparsed titles", () => {
  const entry = {
    infoHash: "episode-one-hash",
    addonId: "comet",
    resolution: "1080p",
    releaseGroup: "NTB",
    source: "WEB-DL",
    savedAt: Date.now(),
  };
  const otherAddon = {
    infoHash: "episode-two-hash",
    addonId: "torrentio",
    resolution: "1080p",
    releaseGroupNormalized: "NTB",
    source: "WEB-DL",
  };
  const otherGroup = {
    infoHash: "episode-two-hash",
    addonId: "comet",
    resolution: "1080p",
    releaseGroupNormalized: "FLUX",
    source: "WEB-DL",
  };
  const unknownGroup = {
    infoHash: "episode-two-hash",
    addonId: "comet",
    resolution: "1080p",
    releaseGroupNormalized: null,
    source: "WEB-DL",
  };
  const entryWithoutGroup = { ...entry, releaseGroup: null };

  assert.equal(streamMatchesReleaseLineage(otherAddon, entry), false);
  assert.equal(streamMatchesReleaseLineage(otherGroup, entry), false);
  assert.equal(streamMatchesReleaseLineage(unknownGroup, entry), false);
  assert.equal(streamMatchesReleaseLineage(otherGroup, entryWithoutGroup), false);
});

test("an aggregator contributor keeps the remembered addon's source", () => {
  const entry = {
    infoHash: "episode-one-hash",
    addonId: "community.aiostreams",
    resolution: "1080p",
    releaseGroup: "NTB",
    source: "WEB-DL",
    savedAt: Date.now(),
  };
  const merged = {
    infoHash: "episode-two-hash",
    addonId: "torrentio",
    contributors: [{ id: "torrentio" }, { id: "community.aiostreams" }],
    resolution: "1080p",
    releaseGroupNormalized: "NTB",
    source: "WEB-DL",
  };

  assert.equal(streamMatchesReleaseLineage(merged, entry), true);
  assert.equal(streamMatchesPreferredSource(merged, entry), true);
});

test("a later episode that drops its release-group suffix keeps the addon source", () => {
  const entry = {
    infoHash: "episode-one-hash",
    addonId: "community.aiostreams",
    resolution: "4K",
    releaseGroup: "BENTHEMEN",
    source: "WEB-DL",
    savedAt: Date.now(),
  };
  const unparsed = {
    infoHash: "episode-two-hash",
    addonId: "torrentio",
    contributors: [{ id: "torrentio" }, { id: "community.aiostreams" }],
    resolution: "4K",
    releaseGroupNormalized: null,
    source: "WEB-DL",
  };

  assert.equal(streamMatchesReleaseLineage(unparsed, entry), false);
  assert.equal(streamMatchesPreferredSource(unparsed, entry), true);
  assert.equal(
    streamMatchesPreferredSource(
      { ...unparsed, releaseGroupNormalized: "DIFFERENT" },
      entry,
    ),
    false,
  );
});

test("the same release group does not change the quality", () => {
  const entry = {
    infoHash: "episode-one-hash",
    addonId: "community.aiostreams",
    resolution: "1080p",
    releaseGroup: "MEGUSTA",
    source: null,
    savedAt: Date.now(),
  };
  const next4k = {
    infoHash: "episode-two-hash",
    addonId: "community.aiostreams",
    resolution: "4K",
    releaseGroupNormalized: "MEGUSTA",
    source: "WEB-DL",
  };
  const next1080 = {
    ...next4k,
    infoHash: "episode-two-1080",
    resolution: "1080p",
  };

  assert.equal(streamMatchesReleaseLineage(next4k, entry), false);
  assert.equal(streamMatchesPreferredSource(next4k, entry), false);
  assert.equal(streamMatchesPreferredSource(next1080, entry), true);
  assert.equal(
    streamMatchesPreferredSource(
      { ...next1080, releaseGroupNormalized: "FLUX" },
      entry,
    ),
    false,
  );
});

test("the same group and quality win over a higher-ranked 4K release", () => {
  const entry = {
    infoHash: "episode-one-hash",
    addonId: "community.aiostreams",
    resolution: "1080p",
    releaseGroup: "MEGUSTA",
    source: "WEB-DL",
    savedAt: Date.now(),
  };
  const flux4k = {
    infoHash: "episode-two-flux",
    addonId: "community.aiostreams",
    resolution: "4K",
    releaseGroupNormalized: "FLUX",
    source: "WEB-DL",
  };
  const megusta4k = {
    infoHash: "episode-two-megusta-4k",
    addonId: "community.aiostreams",
    resolution: "4K",
    releaseGroupNormalized: "MEGUSTA",
    source: "WEB-DL",
  };
  const megusta1080 = {
    infoHash: "episode-two-megusta-1080",
    addonId: "community.aiostreams",
    resolution: "1080p",
    releaseGroupNormalized: "MEGUSTA",
    source: "WEB-DL",
  };

  assert.equal(
    findPreferredSourceMatch(
      [flux4k, megusta4k, megusta1080],
      entry,
      streamMatchesPreferredSource,
    ),
    megusta1080,
  );
});

test("a Russian dub stays ahead of an unlabelled English release", () => {
  const entry = {
    infoHash: "episode-one-rusdub",
    addonId: "community.aiostreams",
    resolution: "1080p",
    releaseGroup: null,
    source: "WEBRip",
    audioLanguages: ["Russian"],
    savedAt: Date.now(),
  };
  const megusta = {
    infoHash: "episode-two-megusta",
    addonId: "community.aiostreams",
    resolution: "1080p",
    releaseGroupNormalized: "MEGUSTA",
    source: "WEB-DL",
    audioLanguages: null,
  };
  const rusdub = {
    infoHash: "episode-two-rusdub",
    addonId: "community.aiostreams",
    resolution: "1080p",
    releaseGroupNormalized: "RUDUB",
    source: "WEBRip",
    audioLanguages: ["Russian"],
  };
  const english = {
    ...rusdub,
    infoHash: "episode-two-english",
    audioLanguages: ["English"],
  };

  assert.equal(streamMatchesPreferredSource(english, entry), false);
  assert.equal(
    findPreferredSourceMatch([megusta, rusdub, english], entry, streamMatchesPreferredSource),
    rusdub,
  );
});

test("the selected addon wins over a same-file debrid library copy", () => {
  const entry = {
    infoHash: "same-hash",
    fileIdx: 1,
    addonId: "torrentio",
    resolution: "4K",
    source: "WEB-DL",
    savedAt: Date.now(),
  };
  const library = {
    infoHash: "same-hash",
    fileIdx: 1,
    addonId: "tb-library",
    addonName: "TorBox Library",
    resolution: "4K",
    source: "WEB-DL",
  };
  const selected = {
    infoHash: "same-hash",
    fileIdx: 1,
    addonId: "torrentio",
    addonName: "Torrentio",
    resolution: "4K",
    source: "WEB-DL",
  };

  assert.equal(
    findPreferredSourceMatch([library, selected], entry, streamMatchesSource),
    selected,
  );
});

test("auto-play waits while the remembered source addon is still loading", () => {
  const entry = {
    addonId: "community.comet",
    resolution: "4K",
    source: "BluRay",
    savedAt: Date.now(),
  };
  const progress = {
    settled: 1,
    total: 2,
    queriedAddonIds: ["community.comet", "com.stremio.torrentio.addon"],
    settledAddonIds: ["com.stremio.torrentio.addon"],
  };

  assert.equal(preferredSourceAddonPending(entry, false, false, progress), true);
});

test("auto-play may fall back after the remembered source addon settles without a match", () => {
  const entry = {
    addonId: "community.comet",
    resolution: "4K",
    source: "BluRay",
    savedAt: Date.now(),
  };
  const progress = {
    settled: 2,
    total: 2,
    queriedAddonIds: ["community.comet", "com.stremio.torrentio.addon"],
    settledAddonIds: ["community.comet", "com.stremio.torrentio.addon"],
  };

  assert.equal(preferredSourceAddonPending(entry, false, false, progress), false);
});

test("auto-play does not wait once the remembered source already matched", () => {
  const entry = {
    addonId: "community.comet",
    resolution: "4K",
    source: "BluRay",
    savedAt: Date.now(),
  };
  const progress = {
    settled: 0,
    total: 1,
    queriedAddonIds: ["community.comet"],
    settledAddonIds: [],
  };

  assert.equal(preferredSourceAddonPending(entry, true, false, progress), false);
});
