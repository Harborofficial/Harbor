import assert from "node:assert/strict";
import test from "node:test";
import { flushPromises, hookHarness } from "./helpers/hook-harness.ts";

function trailer(
  invoke: (...args: any[]) => Promise<unknown>,
  expected: { transcode?: boolean; audioUrl?: string } = {},
) {
  return hookHarness(
    "src/lib/trailer.ts",
    "fetchTrailer",
    {
      "@tauri-apps/api/core": { invoke },
      "@/lib/cache": {},
      "@/lib/cinemeta": {},
      "@/lib/providers/tmdb": {},
      "@/lib/stream-proxy": {
        registerStreamProxy: async (url: string, headers: unknown, options: unknown) => {
          assert.equal(url, "https://media.example/trailer.mp4");
          assert.deepEqual(headers, { "User-Agent": "extractor" });
          assert.deepEqual(options, {
            transcode: expected.transcode || undefined,
            fragmentedMp4: true,
            ...(expected.audioUrl ? { audioUrl: expected.audioUrl } : {}),
          });
          return { url: "http://localhost/trailer", sessionId: "fixture" };
        },
      },
    },
    { window: { __TAURI_INTERNALS__: {} } },
  );
}

test("trailer playback resolves a header-bound stream without downloading the video", async () => {
  const calls: string[] = [];
  const h = trailer(async (command) => {
    calls.push(command);
    return { url: "https://media.example/trailer.mp4", headers: { "User-Agent": "extractor" } };
  });
  const result = await h.render("fixture");
  assert.equal(result.stream_url, "http://localhost/trailer");
  assert.deepEqual(calls, ["resolve_youtube_stream"]);
  assert.equal(await h.render("fixture"), result, "resolved URLs are reused");
});

test("YouTube HLS playback requests a browser-compatible fragmented MP4 stream", async () => {
  const h = trailer(
    async () => ({
      url: "https://media.example/trailer.mp4",
      headers: { "User-Agent": "extractor" },
      transcode: true,
    }),
    { transcode: true },
  );
  assert.equal((await h.render("fixture")).stream_url, "http://localhost/trailer");
});

test("separate HLS audio is forwarded to the proxy", async () => {
  const h = trailer(
    async () => ({
      url: "https://media.example/trailer.mp4",
      audio_url: "https://media.example/trailer-audio.mp4",
      headers: { "User-Agent": "extractor" },
      transcode: true,
    }),
    { transcode: true, audioUrl: "https://media.example/trailer-audio.mp4" },
  );
  assert.equal((await h.render("fixture")).stream_url, "http://localhost/trailer");
});

test("stream extraction failure falls back to the existing download path", async () => {
  const calls: string[] = [];
  const h = trailer(async (command) => {
    calls.push(command);
    if (command === "resolve_youtube_stream") throw new Error("unavailable");
    return { file_path: "fixture.mp4" };
  });
  assert.equal((await h.render("fixture")).file_path, "fixture.mp4");
  assert.deepEqual(calls, ["resolve_youtube_stream", "fetch_trailer"]);
});

test("manual trailer prefetch starts the seekable download path", async () => {
  const calls: string[] = [];
  const h = hookHarness(
    "src/lib/trailer.ts",
    "prefetchTrailerDownload",
    {
      "@tauri-apps/api/core": {
        invoke: async (command: string) => {
          calls.push(command);
          return { file_path: "fixture.mp4" };
        },
      },
      "@/lib/cache": {},
      "@/lib/cinemeta": {},
      "@/lib/providers/tmdb": {},
      "@/lib/stream-proxy": {},
    },
    { window: { __TAURI_INTERNALS__: {} } },
  );
  h.render("fixture");
  await flushPromises();
  assert.deepEqual(calls, ["fetch_trailer"]);
});
