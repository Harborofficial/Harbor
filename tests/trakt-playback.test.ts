// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import { readFileSync } from "node:fs";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import test from "node:test";
import ts from "typescript";

class StubTraktApiError extends Error {
  status: number;
  constructor(status: number, body = "") {
    super(`Trakt HTTP ${status}: ${body}`);
    this.status = status;
  }
}

function playback(raw: unknown[], failure?: Error) {
  const requests: Array<{ path: string; method?: string }> = [];
  const source = readFileSync(new URL("../src/lib/trakt/playback.ts", import.meta.url), "utf8");
  const mocks: Record<string, unknown> = {
    "./client": {
      traktRequest: async (path: string, opts: { method?: string } = {}) => {
        requests.push({ path, method: opts.method });
        if (failure) throw failure;
        return raw;
      },
      TraktApiError: StubTraktApiError,
    },
    "./session": { getSession: () => ({}) },
    "@/lib/cw-dismiss": { isCwDismissed: () => true },
    "@/lib/resume": {
      readResumeEntry: () => undefined,
      saveResumeMs: () => {},
    },
  };
  const module = { exports: {} };
  const output = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  new Function("require", "module", "exports", output)(
    (name: string) => {
      assert.ok(Object.hasOwn(mocks, name), `Unexpected dependency: ${name}`);
      return mocks[name];
    },
    module,
    module.exports,
  );
  return {
    api: module.exports as typeof import("../src/lib/trakt/playback"),
    requests,
  };
}

test("Trakt playback keeps the playback id and the TMDB alias for cross-source matching", async () => {
  const h = playback([
    {
      id: 42,
      progress: 50,
      paused_at: "2026-09-29T10:30:00.000Z",
      movie: { title: "Movie", ids: { imdb: "tt123", tmdb: 456 } },
    },
    {
      id: 43,
      progress: 45,
      paused_at: "2026-09-29T10:30:00.000Z",
      show: { title: "Show", ids: { imdb: "tt789", tmdb: 987 } },
      episode: { season: 1, number: 2 },
    },
  ]);

  const items = await h.api.fetchTraktPlaybackItems();

  assert.deepEqual(
    items.map((item) => item.state?.video_id),
    [undefined, "tt789:1:2"],
  );
  assert.deepEqual(items[0].providerPlaybackIds, { trakt: "42" });
  assert.deepEqual(items[0].altIds, ["tmdb:movie:456"]);
  assert.deepEqual(items[1].providerPlaybackIds, { trakt: "43" });
  assert.deepEqual(items[1].altIds, ["tmdb:tv:987"]);
});

test("Trakt playback deletion treats a missing item as already cleared", async () => {
  const h = playback([], new StubTraktApiError(404));

  assert.equal(await h.api.deleteTraktPlayback("42"), true);
  assert.deepEqual(h.requests, [{ path: "/sync/playback/42", method: "DELETE" }]);
});

test("Trakt playback deletion reports a real provider failure", async () => {
  const h = playback([], new StubTraktApiError(500));

  assert.equal(await h.api.deleteTraktPlayback("42"), false);
  assert.deepEqual(h.requests, [{ path: "/sync/playback/42", method: "DELETE" }]);
});
