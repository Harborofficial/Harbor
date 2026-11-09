import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { RATINGS_CACHE_TTL_MS } from "../src/views/profile/use-quoted-rating.ts";

function deferred() {
  let resolve!: (page: any) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<any>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

const page = (ids: string[], nextCursor?: string) => ({
  items: ids.map((itemKey) => ({
    itemKey,
    mediaType: "movie",
    score: 8,
    title: itemKey,
    at: "2026-01-01",
  })),
  nextCursor,
});

const flush = () => new Promise<void>((done) => setTimeout(done, 0));

function sessionFixture() {
  let profile = "profile-a";
  let author: any = { id: "account-a", handle: "viewer" };
  let generation = 0;
  const listeners = new Set<() => void>();
  return {
    activeProfileId: () => profile,
    currentAuthor: () => author,
    captureSessionScope: () => {
      const capturedProfile = profile;
      const capturedGeneration = generation;
      return () => capturedProfile === profile && capturedGeneration === generation;
    },
    subscribeAuthor: (fn: () => void) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    switchProfile(next: string) {
      profile = next;
      generation += 1;
      for (const fn of listeners) fn();
    },
    switchAuthor(next: any) {
      author = next;
      generation += 1;
      for (const fn of listeners) fn();
    },
  };
}

/**
 * The loader behind the "#" picker and the resolver behind every quoted card are the same
 * module, so the harness drives that module directly: the ratings API answers page by page and
 * the hook runs on a minimal React that re-renders whenever it sets state. Each harness
 * re-evaluates the module, so the loader's cache never leaks between tests.
 */
function quotedHarness() {
  const states: any[] = [];
  const refs: any[] = [];
  const effects: Array<{ deps: any[]; cleanup?: () => void }> = [];
  let si = 0;
  let ri = 0;
  let ei = 0;
  let dirty = false;
  let pending: Array<{ i: number; deps: any[]; run: () => any }> = [];
  const same = (a: any[], b: any[]) =>
    a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const react = {
    useState(initial: any) {
      const i = si++;
      if (!(i in states)) states[i] = initial;
      return [
        states[i],
        (next: any) => {
          const value = typeof next === "function" ? next(states[i]) : next;
          if (!Object.is(value, states[i])) {
            states[i] = value;
            dirty = true;
          }
        },
      ];
    },
    useRef(initial: any) {
      return refs[ri++] ?? (refs[ri - 1] = { current: initial });
    },
    useEffect(run: () => any, deps: any[]) {
      const i = ei++;
      if (!effects[i] || !same(effects[i].deps, deps)) pending.push({ i, deps, run });
    },
  };
  const requests: Array<{ handle: string; opts: any; job: ReturnType<typeof deferred> }> = [];
  const session = sessionFixture();
  const mocks: Record<string, any> = {
    react,
    "@/lib/active-profile-id": { activeProfileId: session.activeProfileId },
    "@/lib/theme-auth": {
      captureSessionScope: session.captureSessionScope,
      currentAuthor: session.currentAuthor,
      subscribeAuthor: session.subscribeAuthor,
    },
    "@/lib/social/ratings-api": {
      fetchUserRatings(handle: string, opts: any) {
        const job = deferred();
        requests.push({ handle, opts, job });
        return job.promise;
      },
    },
  };
  const source = readFileSync(
    new URL("../src/views/profile/use-quoted-rating.ts", import.meta.url),
    "utf8",
  );
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports: any = {};
  new Function("require", "exports", output)((id: string) => {
    assert.ok(id in mocks, `unexpected import ${id}`);
    return mocks[id];
  }, exports);

  let quote: any = null;
  let value: any = null;

  function render() {
    let loops = 0;
    do {
      assert.ok(++loops < 10, "render should settle");
      dirty = false;
      si = ri = ei = 0;
      pending = [];
      value = exports.useQuotedRating(quote);
      for (const effect of pending) effects[effect.i]?.cleanup?.();
      for (const effect of pending)
        effects[effect.i] = { deps: effect.deps, cleanup: effect.run() };
    } while (dirty);
  }

  async function settle() {
    await flush();
    render();
  }

  async function resolveNext(next: any) {
    const at = requests.length - 1;
    assert.ok(at >= 0, "no ratings request is in flight");
    requests[at].job.resolve(next);
    await flush();
  }

  return {
    requests,
    session,
    /** The picker's path: quote anyone's list and look a rating up in it. */
    load: (handle: string) =>
      exports.loadRatings(handle) as Promise<{ items: any[]; complete: boolean }>,
    /** Walks again after a failure, the way the picker's retry does. */
    reload: (handle: string) =>
      exports.loadRatings(handle) as Promise<{ items: any[]; complete: boolean }>,
    /** The quoted card's path: resolve one rating for a posted comment. */
    async open(next: any) {
      quote = next;
      render();
      await settle();
    },
    resolveNext,
    async rejectNext(error: Error) {
      const at = requests.length - 1;
      assert.ok(at >= 0, "no ratings request is in flight");
      requests[at].job.reject(error);
      await settle();
    },
    settle,
    state: () => value,
  };
}

const quote = (authorHandle: string, itemKey: string) => ({
  authorHandle,
  itemKey,
  mediaType: "movie",
  score: 9,
});

test("the # picker reaches a rating on page four, past the old three-page cap", async () => {
  const h = quotedHarness();
  const list = h.load("alice-walk");
  await h.resolveNext(page(["r1"], "cursor-1"));
  await h.resolveNext(page(["r2"], "cursor-2"));
  await h.resolveNext(page(["r3"], "cursor-3"));
  await h.resolveNext(page(["Blue Heron"], "cursor-4"));
  await h.resolveNext(page(["r5"]));
  const loaded = await list;
  assert.deepEqual(
    loaded.items.map((r) => r.itemKey),
    ["r1", "r2", "r3", "Blue Heron", "r5"],
    "pages four and five must be walked like the first three",
  );
  assert.ok(
    loaded.items.some((r) => r.title.toLowerCase().includes("blue heron")),
    "a rating deep in someone's history stays selectable",
  );
  assert.equal(loaded.complete, true, "a walk that reached the last page is complete");
  assert.equal(h.requests.length, 5, "exactly one request per page, none after the last");
});

test("incomplete picker histories expire and restart from the first page", async () => {
  const originalNow = Date.now;
  let now = 1_000;
  Date.now = () => now;
  try {
    const h = quotedHarness();
    const first = h.load("alice-expiry");
    await h.resolveNext({
      ...page(["r1"], "cursor-1"),
      items: [{ ...page(["r1"]).items[0], title: "Old title", score: 6 }],
    });
    await h.rejectNext(Object.assign(new Error("temporary failure"), { status: 500 }));
    const partial = await first;
    assert.equal(partial.items[0].title, "Old title");
    assert.equal(partial.complete, false);

    now += RATINGS_CACHE_TTL_MS + 1;
    const refreshed = h.load("alice-expiry");
    assert.equal(h.requests.at(-1).opts.cursor, undefined, "expired history restarts at page one");
    await h.resolveNext({
      ...page(["r1"]),
      items: [{ ...page(["r1"]).items[0], title: "Updated title", score: 9 }],
    });
    assert.equal((await refreshed).items[0].title, "Updated title");
    assert.equal((await refreshed).items[0].score, 9);
  } finally {
    Date.now = originalNow;
  }
});

test("quoted rating details refresh after an incomplete cache expires", async () => {
  const originalNow = Date.now;
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  let now = 1_000;
  let nextTimer = 0;
  const timers = new Map<number, () => void>();
  Date.now = () => now;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      setTimeout(callback: () => void) {
        const id = ++nextTimer;
        timers.set(id, callback);
        return id;
      },
      clearTimeout(id: number) {
        timers.delete(id);
      },
    },
  });
  try {
    const h = quotedHarness();
    await h.open(quote("alice-quote-expiry", "r1"));
    await h.resolveNext({
      ...page(["r1"], "cursor-1"),
      items: [{ ...page(["r1"]).items[0], title: "Old title", score: 6 }],
    });
    await h.settle();
    assert.equal(h.state().rating.title, "Old title");

    now += RATINGS_CACHE_TTL_MS + 1;
    const timer = timers.entries().next().value as [number, () => void] | undefined;
    assert.ok(timer, "the quoted card schedules expiry for its cached rating");
    timers.delete(timer[0]);
    timer[1]();
    await h.settle();
    assert.equal(h.requests.at(-1).opts.cursor, undefined, "expired history restarts at page one");
    await h.resolveNext({
      ...page(["r1"]),
      items: [{ ...page(["r1"]).items[0], title: "Updated title", score: 9 }],
    });
    await h.settle();
    assert.equal(h.state().state, "ready");
    assert.equal(h.state().rating.title, "Updated title");
    assert.equal(h.state().rating.score, 9);
  } finally {
    Date.now = originalNow;
    if (windowDescriptor) Object.defineProperty(globalThis, "window", windowDescriptor);
    else delete (globalThis as { window?: unknown }).window;
  }
});

test("a quote refreshes its rating details when the active session changes", async () => {
  const h = quotedHarness();
  await h.open(quote("alice-session", "r1"));
  await h.resolveNext({
    ...page(["r1"]),
    items: [{ ...page(["r1"]).items[0], title: "Old title", score: 6 }],
  });
  await h.settle();
  assert.equal(h.state().rating.title, "Old title");

  h.session.switchAuthor({ id: "account-b", handle: "viewer-b" });
  await h.settle();
  assert.equal(
    h.requests.at(-1).opts.cursor,
    undefined,
    "the new session starts with a fresh page",
  );
  await h.resolveNext({
    ...page(["r1"]),
    items: [{ ...page(["r1"]).items[0], title: "Updated title", score: 9 }],
  });
  await h.settle();
  assert.equal(h.state().state, "ready");
  assert.equal(h.state().rating.title, "Updated title");
  assert.equal(h.state().rating.score, 9);
});

test("the walk stops at the last page instead of asking for another", async () => {
  const h = quotedHarness();
  const list = h.load("alice-stop");
  await h.resolveNext(page(["only"]));
  assert.equal((await list).items.length, 1);
  assert.equal(h.requests.length, 1, "no request after a page without nextCursor");
});

test("a quote pointing at a page-four rating resolves instead of showing as missing", async () => {
  const h = quotedHarness();
  await h.open(quote("alice-resolve", "r4"));
  await h.resolveNext(page(["r1"], "cursor-1"));
  await h.resolveNext(page(["r2"], "cursor-2"));
  await h.resolveNext(page(["r3"], "cursor-3"));
  await h.resolveNext(page(["r4"], "cursor-4"));
  await h.resolveNext(page(["r5"]));
  await h.settle();
  assert.equal(h.state().state, "ready", "a rating that still exists must not read as missing");
  assert.equal(h.state().rating.itemKey, "r4");
  assert.equal(h.state().rating.title, "r4");
});

test("a rating deleted after it was quoted reports missing rather than breaking", async () => {
  const h = quotedHarness();
  await h.open(quote("alice-deleted", "gone"));
  await h.resolveNext(page(["kept"]));
  await h.settle();
  assert.equal(h.state().state, "missing");
  assert.equal(h.state().rating, undefined);
});

test("a refused ratings list reports missing instead of hanging on the spinner", async () => {
  const h = quotedHarness();
  await h.open(quote("alice-private", "r1"));
  await h.rejectNext(Object.assign(new Error("403 forbidden"), { status: 403 }));
  await h.settle();
  assert.equal(h.state().state, "missing");
});

test("account changes discard scoped ratings and re-fetch from the first page", async () => {
  const h = quotedHarness();
  const first = h.load("alice-account");
  await h.resolveNext(page(["r1"]));
  await first;

  h.session.switchProfile("profile-b");
  const next = h.load("alice-account");
  assert.equal(h.requests.at(-1).opts.cursor, undefined, "a new account must not reuse the cache");
  await h.resolveNext(page(["r2"]));
  assert.deepEqual(
    (await next).items.map((rating) => rating.itemKey),
    ["r2"],
  );
});

test("a 403 clears previously cached ratings before reporting the list unavailable", async () => {
  const h = quotedHarness();
  await h.open(quote("alice-revoked", "r1"));
  await h.resolveNext(page(["r1"], "cursor-1"));
  await h.settle();
  assert.equal(h.state().state, "ready");

  const refused = h.load("alice-revoked");
  assert.equal(h.requests.at(-1).opts.cursor, "cursor-1");
  await h.rejectNext(Object.assign(new Error("403 forbidden"), { status: 403 }));
  assert.deepEqual((await refused).items, [], "refusal must clear pages loaded before it");

  const afterRefusal = h.load("alice-revoked");
  assert.equal(h.requests.at(-1).opts.cursor, undefined, "retry starts with a fresh history");
  await h.resolveNext(page(["r2"]));
  assert.deepEqual(
    (await afterRefusal).items.map((rating) => rating.itemKey),
    ["r2"],
  );
});

test("a failed later page keeps the ratings that already loaded", async () => {
  const h = quotedHarness();
  const list = h.load("alice-partial");
  await h.resolveNext(page(["r1"], "cursor-1"));
  await h.resolveNext(page(["r2"], "cursor-2"));
  await h.resolveNext(page(["r3"], "cursor-3"));
  await h.rejectNext(Object.assign(new Error("boom"), { status: 500 }));
  const loaded = await list;
  assert.deepEqual(
    loaded.items.map((r) => r.itemKey),
    ["r1", "r2", "r3"],
    "pages that arrived must survive the page that failed",
  );
  assert.equal(loaded.complete, false, "a stopped walk is reported as unfinished");
});

test("a failed walk resumes from the cursor it stopped at", async () => {
  const h = quotedHarness();
  const first = h.load("alice-resume");
  await h.resolveNext(page(["r1"], "cursor-1"));
  await h.resolveNext(page(["r2"], "cursor-2"));
  await h.rejectNext(Object.assign(new Error("boom"), { status: 500 }));
  await first;

  const retry = h.reload("alice-resume");
  assert.equal(
    h.requests.at(-1).opts.cursor,
    "cursor-2",
    "the retry continues where the failure happened",
  );
  await h.resolveNext(page(["r3"]));
  const loaded = await retry;
  assert.deepEqual(
    loaded.items.map((r) => r.itemKey),
    ["r1", "r2", "r3"],
    "the retry appends to what was kept instead of refetching from the start",
  );
  assert.equal(loaded.complete, true);
});

test("quote resolution stops as soon as the rating is found", async () => {
  const h = quotedHarness();
  await h.open(quote("alice-early", "r2"));
  await h.resolveNext(page(["r1"], "cursor-1"));
  await h.resolveNext(page(["r2"], "cursor-2"));
  await h.settle();
  assert.equal(h.state().state, "ready");
  assert.equal(h.state().rating.itemKey, "r2");
  assert.equal(h.requests.length, 2, "pages behind the found rating are never requested");
});

test("a quote past a failed page reads as incomplete rather than missing", async () => {
  const h = quotedHarness();
  await h.open(quote("alice-incomplete", "deep"));
  await h.resolveNext(page(["r1"], "cursor-1"));
  await h.rejectNext(Object.assign(new Error("boom"), { status: 500 }));
  await h.settle();
  assert.equal(h.state().state, "incomplete");
  assert.equal(typeof h.state().retry, "function", "an unfinished walk offers a retry");
});

test("a cursor that stops advancing ends the walk instead of looping", async () => {
  const h = quotedHarness();
  const list = h.load("alice-loop");
  await h.resolveNext(page(["r1"], "cursor-1"));
  await h.resolveNext(page(["r1"], "cursor-1"));
  const loaded = await list;
  assert.equal(h.requests.length, 2, "the repeated cursor stops the walk");
  assert.equal(loaded.items.length, 1, "a page served twice is not appended twice");
  assert.equal(loaded.complete, true);
});

test("quoted ratings resolve by item key and media type, not item key alone", async () => {
  const h = quotedHarness();
  await h.open({ ...quote("alice-collision", "tmdb:123"), mediaType: "series" });
  await h.resolveNext({
    items: [
      { itemKey: "tmdb:123", mediaType: "movie", score: 2, title: "Movie", at: "2026-01-01" },
      { itemKey: "tmdb:123", mediaType: "series", score: 9, title: "Series", at: "2026-01-01" },
    ],
  });
  await h.settle();
  assert.equal(h.state().state, "ready");
  assert.equal(h.state().rating.mediaType, "series");
  assert.equal(h.state().rating.title, "Series");
  assert.equal(h.state().rating.score, 9);
});

test("quote lookup walks past a matching ID with a different media type", async () => {
  const h = quotedHarness();
  await h.open({ ...quote("alice-collision-pages", "tmdb:123"), mediaType: "series" });
  await h.resolveNext({
    items: [
      { itemKey: "tmdb:123", mediaType: "movie", score: 2, title: "Movie", at: "2026-01-01" },
    ],
    nextCursor: "page-two",
  });
  await h.resolveNext({
    items: [
      { itemKey: "tmdb:123", mediaType: "series", score: 9, title: "Series", at: "2026-01-01" },
    ],
  });
  await h.settle();
  assert.equal(h.state().state, "ready");
  assert.equal(h.state().rating.mediaType, "series");
  assert.equal(h.requests.length, 2);
});

test("a quote switching media type refreshes from cached ratings of that identity", async () => {
  const h = quotedHarness();
  const movieQuote = quote("alice-switch-type", "tmdb:123");
  await h.open(movieQuote);
  await h.resolveNext({
    items: [
      { itemKey: "tmdb:123", mediaType: "movie", score: 2, title: "Movie", at: "2026-01-01" },
      { itemKey: "tmdb:123", mediaType: "series", score: 9, title: "Series", at: "2026-01-01" },
    ],
  });
  await h.settle();
  assert.equal(h.state().rating.mediaType, "movie");
  await h.open({ ...movieQuote, mediaType: "series" });
  assert.equal(h.state().state, "ready");
  assert.equal(h.state().rating.mediaType, "series");
  assert.equal(h.requests.length, 1, "both ratings were already cached");
});
