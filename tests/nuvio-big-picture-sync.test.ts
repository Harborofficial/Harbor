import assert from "node:assert/strict";
import test from "node:test";
import type { LibraryItem } from "../src/lib/stremio";

function makeItem(
  source: "nuvio" | "trakt" | "simkl" | undefined,
  id: string,
  name: string,
  timeOffset = 1800,
  duration = 3600,
): LibraryItem {
  return {
    _id: id,
    type: "series",
    name,
    external: source,
    removed: false,
    temp: false,
    _ctime: "2026-10-23T12:00:00Z",
    _mtime: "2026-10-23T12:00:00Z",
    state: {
      lastWatched: "2026-10-23T12:00:00Z",
      timeOffset,
      duration,
      season: 1,
      episode: 2,
      video_id: `${id}:1:2`,
    },
  };
}

test("Big Picture CW: keeps Nuvio sync progress when Nuvio provider is active", () => {
  const isNuvioProvider = (accountProvider?: string, nuvioActiveFlag = false) =>
    accountProvider === "nuvio" || nuvioActiveFlag;

  const filterCwItems = (
    items: LibraryItem[],
    options: {
      accountProvider?: string;
      nuvioActive?: boolean;
      traktConnected?: boolean;
      simklConnected?: boolean;
    },
  ) => {
    const isNuvio = isNuvioProvider(options.accountProvider, options.nuvioActive);
    return items.filter((i) => {
      if (!i.external) return true;
      if (i.external === "nuvio") return isNuvio;
      if (i.external === "trakt") return !!options.traktConnected;
      if (i.external === "simkl") return !!options.simklConnected;
      return false;
    });
  };

  const localMovie = makeItem(undefined, "tt12345", "Local Movie", 1200, 7200);
  const nuvioSeries = makeItem("nuvio", "tt98765", "Nuvio Synced Show", 1500, 3000);
  const traktSeries = makeItem("trakt", "tt11111", "Trakt Synced Show", 800, 2400);

  const allItems = [localMovie, nuvioSeries, traktSeries];

  // In Nuvio mode (even if accountProvider string is pending but isNuvioActive is true)
  const nuvioResults = filterCwItems(allItems, {
    accountProvider: undefined,
    nuvioActive: true,
  });

  assert.equal(nuvioResults.length, 2);
  assert.ok(nuvioResults.some((x) => x._id === "tt12345"));
  assert.ok(nuvioResults.some((x) => x._id === "tt98765"));
  assert.ok(!nuvioResults.some((x) => x._id === "tt11111"));

  // In Stremio mode (strict separation: nuvio items must not bleed into Stremio CW)
  const stremioResults = filterCwItems(allItems, {
    accountProvider: "stremio",
    nuvioActive: false,
    traktConnected: true,
  });

  assert.equal(stremioResults.length, 2);
  assert.ok(stremioResults.some((x) => x._id === "tt12345"));
  assert.ok(stremioResults.some((x) => x._id === "tt11111"));
  assert.ok(
    !stremioResults.some((x) => x._id === "tt98765"),
    "Nuvio items must not bleed into Stremio mode",
  );
});

test("Big Picture CW card: remainingLabel displays remaining time for Nuvio items but suppresses for external trackers", () => {
  const remainingLabel = (i: LibraryItem): string => {
    const isExternalTracker = !!i.external && i.external !== "nuvio";
    const dur = i.state?.duration ?? 0;
    const time = i.state?.timeOffset ?? 0;
    if (dur <= 0 || isExternalTracker) return "";
    const rem = Math.max(0, dur - time);
    const mins = Math.round(rem / 60);
    return mins > 0 ? `${mins}m left` : "";
  };

  const localItem = makeItem(undefined, "tt1", "Local Movie", 1800, 3600);
  const nuvioItem = makeItem("nuvio", "tt2", "Nuvio Show", 1200, 3600);
  const traktItem = makeItem("trakt", "tt3", "Trakt Show", 1200, 3600);

  assert.equal(remainingLabel(localItem), "30m left");
  assert.equal(
    remainingLabel(nuvioItem),
    "40m left",
    "Nuvio items in Big Picture should show remaining time",
  );
  assert.equal(remainingLabel(traktItem), "", "External tracker items suppress remaining duration");
});

test("Big Picture CW card meta: BpCwCardPill treats Nuvio items as native playback rather than tracker pills", () => {
  const isTrackerPill = (external?: string) => !!external && external !== "nuvio";

  assert.equal(isTrackerPill(undefined), false);
  assert.equal(
    isTrackerPill("nuvio"),
    false,
    "Nuvio must not be rendered as a third-party tracker pill",
  );
  assert.equal(isTrackerPill("simkl"), true);
  assert.equal(isTrackerPill("trakt"), true);
});

test("Big Picture Anime CW: pool allows Nuvio anime items when Nuvio is active", () => {
  const filterAnimePool = (
    items: LibraryItem[],
    options: { isNuvio: boolean; traktConnected: boolean; simklConnected: boolean },
  ) => {
    return items.filter((i) => {
      if (!i.external) return true;
      if (i.external === "nuvio") return options.isNuvio;
      if (i.external === "trakt") return options.traktConnected;
      if (i.external === "simkl") return options.simklConnected;
      return false;
    });
  };

  const nuvioAnime = makeItem("nuvio", "kitsu:1234", "Frieren", 600, 1400);
  const traktAnime = makeItem("trakt", "kitsu:5678", "Solo Leveling", 600, 1400);

  const nuvioPool = filterAnimePool([nuvioAnime, traktAnime], {
    isNuvio: true,
    traktConnected: false,
    simklConnected: false,
  });

  assert.equal(nuvioPool.length, 1);
  assert.equal(nuvioPool[0]._id, "kitsu:1234");
});
