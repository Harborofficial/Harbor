// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import { readFileSync } from "node:fs";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import test from "node:test";
import type { Settings } from "../src/lib/settings/types.ts";
import { compileMpvOptions, svpMpvLines } from "../src/lib/player/mpv-tuning.ts";
import {
  autoCacheBytes,
  ramCacheCapBytes,
  effectiveBufferProfile,
  bufferTotalBytes,
  bufferMpvLines,
  RAM_CACHE_FALLBACK_BYTES,
} from "../src/lib/player/buffer-profile.ts";
import { resolvePlaybackDownloadedFraction } from "../src/lib/player/playback-clock.ts";
import { playbackStartupProfile } from "../src/lib/player/startup-profile.ts";

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;

test("only the P2P engine reports whole-file download progress", () => {
  assert.equal(
    resolvePlaybackDownloadedFraction({
      isP2pEngine: true,
      streamProgress: 50,
      streamLen: 100,
    }),
    0.5,
  );
  assert.equal(
    resolvePlaybackDownloadedFraction({
      isP2pEngine: false,
      streamProgress: 100,
      streamLen: 100,
    }),
    0,
  );
  assert.equal(
    resolvePlaybackDownloadedFraction({
      isP2pEngine: true,
      streamProgress: 50,
      streamLen: 0,
    }),
    0,
  );
});

test("a fully downloaded local file is reported as cached immediately, not buffering", () => {
  const source = readFileSync(new URL("../src/views/player.tsx", import.meta.url), "utf8");

  const p2pBranchAt = source.indexOf("if (isP2pEngine) {");
  const localBranchAt = source.indexOf("} else if (isLocalSrc) {");
  const genericBufferBranchAt = source.indexOf(
    "setPlaybackDownloaded(dur > 0 ? Math.min(1, (snap.positionSec + snap.bufferedSec) / dur) : 0);",
  );

  assert.ok(p2pBranchAt !== -1, "playback-downloaded effect's P2P branch is missing");
  assert.ok(
    localBranchAt !== -1,
    "local-source branch is missing from the playback-downloaded effect",
  );
  assert.ok(genericBufferBranchAt !== -1, "generic position+buffered heuristic branch is missing");
  assert.ok(
    p2pBranchAt < localBranchAt && localBranchAt < genericBufferBranchAt,
    "local-source branch must be checked before the generic position+buffered heuristic, " +
      "so an already-on-disk downloaded file isn't treated as still buffering",
  );

  const localBranch = source.slice(localBranchAt, genericBufferBranchAt);
  assert.match(
    localBranch,
    /setPlaybackDownloaded\(1\);/,
    "a local (already-on-disk) file must be reported as 100% downloaded, not derived from position + buffered",
  );
});

test("bigger buffer mode increases Harbor defaults and waits for a useful reserve", () => {
  const settings = {
    mpvQuality: "balanced",
    mpvHwdec: "auto",
    mpvBufferBoost: true,
    mpvDownmixStereo: false,
    audioDevice: "auto",
    playerDisplayPanel: "standard",
    playerHdrToSdr: true,
    mpvTweaks: {},
  } as unknown as Settings;

  const options = compileMpvOptions(settings, { totalPhysBytes: 16 * GIB }).split("\n");
  assert.ok(options.includes("cache=yes"));
  assert.ok(options.includes("cache-secs=600"));
  assert.ok(options.includes("demuxer-max-bytes=1GiB"));
  assert.ok(options.includes("demuxer-readahead-secs=600"));
  assert.ok(options.includes("cache-pause-initial=yes"));
  assert.ok(options.includes("cache-pause-wait=10"));
  assert.ok(!options.includes("demuxer-max-bytes=150MiB"));
  assert.ok(!options.includes("demuxer-readahead-secs=20"));
});

test("automatic buffer scales from physical memory within 256 MiB..1 GiB, 75/25 split", () => {
  assert.equal(autoCacheBytes(2 * GIB), 256 * MIB);
  assert.equal(autoCacheBytes(4 * GIB), 256 * MIB);
  assert.equal(autoCacheBytes(8 * GIB), 512 * MIB);
  assert.equal(autoCacheBytes(16 * GIB), GIB);
  assert.equal(autoCacheBytes(32 * GIB), GIB);
  assert.equal(autoCacheBytes(0), 256 * MIB);

  const p = effectiveBufferProfile("auto", 8 * GIB)!;
  assert.equal(bufferTotalBytes(p), 512 * MIB);
  assert.equal(p.maxBytes, 384 * MIB);
  assert.equal(p.maxBackBytes, 128 * MIB);

  const p32 = effectiveBufferProfile("auto", 32 * GIB)!;
  assert.equal(p32.maxBytes, 768 * MIB);
  assert.equal(p32.maxBackBytes, 256 * MIB);
  assert.deepEqual(bufferMpvLines("auto", 32 * GIB), []);
});

test("manual buffer choices are capped by physical memory", () => {
  assert.equal(ramCacheCapBytes(2 * GIB), 256 * MIB);
  assert.equal(ramCacheCapBytes(4 * GIB), 512 * MIB);
  assert.equal(ramCacheCapBytes(8 * GIB), GIB);
  assert.equal(ramCacheCapBytes(16 * GIB), 2 * GIB);
  assert.equal(ramCacheCapBytes(64 * GIB), 2 * GIB);
  assert.equal(ramCacheCapBytes(0), RAM_CACHE_FALLBACK_BYTES);
  assert.equal(RAM_CACHE_FALLBACK_BYTES, 512 * MIB);

  const maxOn8 = effectiveBufferProfile("max", 8 * GIB)!;
  assert.equal(bufferTotalBytes(maxOn8), GIB);
  const maxOn32 = effectiveBufferProfile("max", 32 * GIB)!;
  assert.equal(bufferTotalBytes(maxOn32), 2 * GIB);
  const maxUnknown = effectiveBufferProfile("max", 0)!;
  assert.equal(bufferTotalBytes(maxUnknown), RAM_CACHE_FALLBACK_BYTES);

  const lines = bufferMpvLines("max", 8 * GIB);
  assert.ok(lines.some((line) => line.startsWith("demuxer-max-bytes=")));
  assert.ok(lines.some((line) => line.startsWith("demuxer-max-back-bytes=")));
});

test("Anime4K keeps bilinear off the scaling path", () => {
  const performance = {
    mpvQuality: "performance",
    mpvHwdec: "auto",
    mpvBufferBoost: false,
    mpvDownmixStereo: false,
    audioDevice: "auto",
    playerDisplayPanel: "standard",
    mpvTweaks: {},
  } as unknown as Settings;

  const plain = compileMpvOptions(performance).split("\n");
  assert.ok(plain.includes("scale=bilinear"), "the performance profile downsamples by default");

  const withAnime4k = compileMpvOptions(performance, { anime4k: true }).split("\n");
  // mpv runs `scale` after the user shaders, so a bilinear kernel would undo
  // the upscale Anime4K just did.
  assert.ok(!withAnime4k.some((l) => /^(scale|cscale|dscale)=bilinear$/.test(l)));
  // The rest of the cheap profile is unrelated to scaling and stays.
  assert.ok(withAnime4k.includes("dither=no"));
  assert.ok(withAnime4k.includes("vd-lavc-fast=yes"));
});

test("a sharp scaling kernel is left in place for Anime4K", () => {
  const quality = {
    mpvQuality: "quality",
    mpvHwdec: "auto",
    mpvBufferBoost: false,
    mpvDownmixStereo: false,
    audioDevice: "auto",
    playerDisplayPanel: "standard",
    mpvTweaks: {},
  } as unknown as Settings;
  const options = compileMpvOptions(quality, { anime4k: true }).split("\n");
  assert.ok(options.includes("scale=ewa_lanczossharp"));
  assert.ok(options.includes("dscale=mitchell"));
});

test("SVP uses a removable labeled VapourSynth filter", () => {
  const settings = { svpVpyPath: "/home/user/.local/share/harbor/svp/svp.vpy" } as Settings;
  const options = svpMpvLines(settings, true).split("\n");
  assert.equal(
    options[0],
    "vf=@harbor-svp:vapoursynth=[/home/user/.local/share/harbor/svp/svp.vpy]",
  );
  assert.ok(options.includes("hwdec=auto-copy"));
});

test("high-bitrate releases receive a distinct startup profile", () => {
  const standard = playbackStartupProfile({ resolution: "1080p", source: "WEB-DL", size: 4e9 });
  const highResolution = playbackStartupProfile({ resolution: "4K", source: "BluRay" });
  const largeRemux = playbackStartupProfile({ resolution: "1080p", source: "REMUX", size: 18e9 });

  assert.equal(standard, "standard");
  assert.equal(highResolution, "high-bitrate");
  assert.equal(largeRemux, "high-bitrate");
});
