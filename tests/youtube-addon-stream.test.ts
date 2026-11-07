import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

function resolver(invoke: (...args: any[]) => Promise<unknown>) {
  const output = ts.transpileModule(readFileSync("src/lib/streams/resolve.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const api: any = {};
  new Function("require", "exports", output)((name: string) => {
    if (name === "@tauri-apps/api/core") return { invoke };
    if (name === "./stream-subtitles") return { streamSubtitles: () => [] };
    return {};
  }, api);
  return api.resolveStream;
}

test("Game Cinema YouTube streams resolve internally and preserve request headers", async () => {
  const resolve = resolver(async (command, args) => {
    assert.equal(command, "resolve_youtube_stream");
    assert.deepEqual(args, { videoId: "dQw4w9WgXcQ" });
    return { url: "https://media.example/video.mp4", headers: { "User-Agent": "resolver" } };
  });
  const result = await resolve({ ytId: "dQw4w9WgXcQ" }, [], new AbortController().signal, true);
  assert.equal(result.ok, true);
  assert.equal(result.via, "youtube");
  assert.equal(result.data.headers["User-Agent"], "resolver");
});

test("explicit browser links bypass extraction and cancelled resolutions cannot start playback", async () => {
  const controller = new AbortController();
  let calls = 0;
  const resolve = resolver(async () => {
    calls++;
    controller.abort();
    return { url: "https://media.example/video.mp4" };
  });
  const browser = await resolve(
    { externalUrl: "https://youtube.com/watch?v=fixture" },
    [],
    controller.signal,
    true,
  );
  assert.equal(browser.code, "external-url-only");
  assert.equal(calls, 0);
  const cancelled = await resolve({ ytId: "fixture" }, [], controller.signal, true);
  assert.equal(cancelled.code, "aborted");
  assert.equal(calls, 1);
});
