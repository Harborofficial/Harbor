// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import { readFileSync } from "node:fs";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import test from "node:test";
import ts from "typescript";

class StubTraktApiError extends Error {
  status: number;
  retryAt?: number;
  constructor(status: number, body = "", retryAt?: number) {
    super(`Trakt HTTP ${status}: ${body}`);
    this.status = status;
    this.retryAt = retryAt;
  }
}

type Response = { data: unknown; headers?: Record<string, string> };

function load(respond: (path: string, opts: { method?: string }) => Promise<Response>) {
  const requests: Array<{ path: string; method?: string }> = [];
  const source = readFileSync(new URL("../src/lib/trakt/playback.ts", import.meta.url), "utf8");
  const mocks: Record<string, unknown> = {
    "./client": {
      traktRequest: async (path: string, opts: { method?: string } = {}) =>
        (await respond(path, opts)).data,
      traktRequestWithResponse: async (path: string, opts: { method?: string } = {}) => {
        const response = await respond(path, opts);
        return {
          data: response.data,
          status: 200,
          headers: new Headers(response.headers ?? {}),
        };
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

function playback(raw: unknown[], failure?: Error) {
  const h = load(async (path, opts) => {
    h.requests.push({ path, method: opts.method });
    if (failure) throw failure;
    return { data: raw };
  });
  return h;
}

function snapshots(responses: Response[], failure?: Error) {
  const queue = [...responses];
  const h = load(async (path, opts) => {
    h.requests.push({ path, method: opts.method });
    if (failure) throw failure;
    const next = queue.shift();
    if (!next) throw new Error(`Unexpected request: ${path}`);
    return next;
  });
  return h;
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

  assert.deepEqual(await h.api.deleteTraktPlayback("42"), { ok: true });
  assert.deepEqual(h.requests, [{ path: "/sync/playback/42", method: "DELETE" }]);
});

test("Trakt playback deletion reports a real provider failure", async () => {
  const h = playback([], new StubTraktApiError(500));

  assert.deepEqual(await h.api.deleteTraktPlayback("42"), { ok: false });
  assert.deepEqual(h.requests, [{ path: "/sync/playback/42", method: "DELETE" }]);
});

test("Trakt playback deletion surfaces Retry-After", async () => {
  const retryAt = Date.now() + 120_000;
  const h = playback([], new StubTraktApiError(429, "", retryAt));

  const outcome = await h.api.deleteTraktPlayback("42");

  assert.equal(outcome.ok, false);
  assert.ok((outcome.retryAfterMs ?? 0) > 60_000);
});

test("Trakt snapshot follows pagination headers and reports completeness", async () => {
  const raw = (episode: number) => ({
    id: episode,
    progress: 50,
    paused_at: "2026-09-29T10:30:00.000Z",
    show: { title: "Show", ids: { imdb: "tt789" } },
    episode: { season: 1, number: episode },
  });
  const h = snapshots([
    { data: [raw(1)], headers: { "x-pagination-page-count": "2" } },
    { data: [raw(2)], headers: { "x-pagination-page-count": "2" } },
  ]);

  const snapshot = await h.api.fetchTraktPlaybackSnapshot();

  assert.equal(snapshot.complete, true);
  assert.equal(snapshot.items.length, 2);
  assert.deepEqual(
    h.requests.map((request) => request.path),
    ["/sync/playback?limit=40&page=1", "/sync/playback?limit=40&page=2"],
  );
});

test("Trakt snapshot fails closed without a page-count header", async () => {
  const h = snapshots([{ data: [] }]);

  const snapshot = await h.api.fetchTraktPlaybackSnapshot();

  assert.equal(snapshot.complete, false);
  assert.equal(h.requests.length, 1);
});

test("Trakt snapshot fails closed when the page cap is reached", async () => {
  const h = snapshots(
    Array.from({ length: 5 }, () => ({
      data: [],
      headers: { "x-pagination-page-count": "6" },
    })),
  );

  const snapshot = await h.api.fetchTraktPlaybackSnapshot();

  assert.equal(snapshot.complete, false);
  assert.equal(h.requests.length, 5);
});

test("Trakt snapshot treats a list 404 as a failed read", async () => {
  const h = snapshots([], new StubTraktApiError(404));

  await assert.rejects(() => h.api.fetchTraktPlaybackSnapshot());
});

test("Trakt snapshot rejects a malformed list", async () => {
  const h = snapshots([{ data: { items: [] } }]);

  await assert.rejects(() => h.api.fetchTraktPlaybackSnapshot());
});

test("Trakt snapshot keeps distinct playback ids for the same episode", async () => {
  const raw = (id: number) => ({
    id,
    progress: 50,
    paused_at: "2026-09-29T10:30:00.000Z",
    show: { title: "Show", ids: { imdb: "tt789" } },
    episode: { season: 1, number: 5 },
  });
  const h = snapshots([{ data: [raw(1), raw(2)], headers: { "x-pagination-page-count": "1" } }]);

  const snapshot = await h.api.fetchTraktPlaybackSnapshot();

  assert.equal(snapshot.items.length, 2, "both pause records reach the deletion queue");
  assert.deepEqual(snapshot.items.map((entry) => entry.providerPlaybackIds?.trakt).sort(), [
    "1",
    "2",
  ]);
});
