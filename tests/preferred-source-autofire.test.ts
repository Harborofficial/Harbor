import assert from "node:assert/strict";
import test from "node:test";
import { hookHarness } from "./helpers/hook-harness.ts";
import { preferredSourceAddonPending } from "../src/lib/playback-history.ts";

test("late preferred source blocks fast candidates and settlement permits fallback without hanging", () => {
  const played: unknown[] = [];
  const hook = hookHarness(
    "src/views/play-picker/use-auto-fire.ts",
    "useAutoFire",
    {
      "@/lib/torrent/stremio-stream": { engineP2pEligible: () => false },
      "./picker-utils": {
        hasInstantMarker: () => true,
        streamMatchesLangs: () => true,
        torrentFilename: () => "",
      },
      "@/lib/streams/episode-file": { episodeVariantMatch: () => true },
      "@/lib/episode-span": { episodeSpanContains: () => true },
      "@/lib/playback-history": { preferredSourceAddonPending },
    },
    { window: { setTimeout: () => 1, clearTimeout() {} } },
  );
  const fast = { url: "https://example.test/fast" };
  const args = {
    autoActive: true,
    autoCandidates: [fast],
    resolving: null,
    autoAttemptIdx: 0,
    autoSettleReady: true,
    pipelineDone: false,
    firstResultAt: 0,
    isCached: () => true,
    p2pAutoConsent: false,
    preferredLangs: [],
    hasStrongAddon: false,
    isTorrentioStream: () => false,
    preferredSourceEntry: { addonId: "aio", savedAt: 1 },
    preferredSourceMatched: false,
    addonQuorum: {
      settled: 1,
      total: 2,
      queriedAddonIds: ["fast", "aio"],
      settledAddonIds: ["fast"],
    },
    pipelineStartedAt: 0,
    autoFiredRef: { current: false },
    setAutoSettleReady() {},
    setAutoCancelled() {},
    onPlay: (stream: unknown) => played.push(stream),
  };
  assert.equal(hook.render(args).waitingForPreferredSource, true);
  assert.deepEqual(played, []);
  hook.render({
    ...args,
    addonQuorum: { ...args.addonQuorum, settled: 2, settledAddonIds: ["fast", "aio"] },
  });
  assert.deepEqual(played, [fast]);
  hook.unmount();
});
