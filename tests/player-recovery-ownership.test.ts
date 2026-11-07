import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { emptySnapshot } from "../src/lib/player/bridge.ts";
import { continuationAppliesToSource } from "../src/lib/player/continue-playback";
import { playbackSourceKey } from "../src/lib/playback-history";
import { playerLoadIdentity } from "../src/lib/player/load-identity";

function deferred<T = any>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function recoveryHarness() {
  const effects: Array<{ deps?: unknown[]; cleanup?: () => void }> = [];
  const refs: Array<{ current: any }> = [],
    states: any[] = [],
    memos: any[] = [];
  let ri = 0,
    si = 0,
    mi = 0,
    ei = 0,
    position = 0,
    timer = 0,
    actorCurrent = true;
  let pending: Array<{ i: number; deps?: unknown[]; run: () => any }> = [];
  const timeouts = new Map<number, { run: () => void; delay: number }>();
  const same = (a?: unknown[], b?: unknown[]) =>
    !!a && !!b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const react = {
    useRef: (value: any) => refs[ri++] ?? (refs[ri - 1] = { current: value }),
    useState: (value: any) => {
      const i = si++;
      if (!(i in states)) states[i] = value;
      return [
        states[i],
        (next: any) => {
          states[i] = typeof next === "function" ? next(states[i]) : next;
        },
      ];
    },
    useCallback: (fn: any, deps: unknown[]) => {
      const i = mi++;
      if (!memos[i] || !same(memos[i].deps, deps)) memos[i] = { deps, fn };
      return memos[i].fn;
    },
    useEffect: (run: () => any, deps?: unknown[]) => {
      const i = ei++;
      if (!effects[i] || !same(effects[i].deps, deps)) pending.push({ i, deps, run });
    },
  };
  const makeBridge = () => ({
    loads: [] as any[],
    destroyed: 0,
    load(src: any) {
      this.loads.push(src);
      return Promise.resolve();
    },
    destroy() {
      this.destroyed++;
    },
  });
  const bridge = makeBridge(),
    bridgeRef = { current: bridge as ReturnType<typeof makeBridge> | null };
  const proxyRequests: Array<{ args: any[]; job: ReturnType<typeof deferred> }> = [];
  const debridRequests: Array<{ args: any[]; job: ReturnType<typeof deferred> }> = [];
  const probes: Array<ReturnType<typeof deferred>> = [],
    pickers: any[][] = [],
    cleared: any[][] = [];
  const dependencies = {
    getPlaybackPosition: () => position,
    getPlaybackBuffered: () => 0,
    usePlaybackFlag: (read: () => boolean) => read(),
    isLocalUrl: () => false,
    isTruncatedEnd: () => false,
    clearOnePickerCache: (...args: any[]) => cleared.push(args),
    isPlaybackActorCurrent: () => actorCurrent,
    continuationAppliesToSource,
    playerLoadIdentity,
    registerStreamProxy: (...args: any[]) => {
      const job = deferred();
      proxyRequests.push({ args, job });
      return job.promise;
    },
    resolveViaDebrids: (...args: any[]) => {
      const job = deferred();
      debridRequests.push({ args, job });
      return job.promise;
    },
    probeStremioServer: () => {
      const job = deferred();
      probes.push(job);
      return job.promise;
    },
    buildTranscodedUrl: (url: string) => `transcode:${url}`,
    BLACK_SCREEN_GRACE_MS: 15000,
    MAX_AUTORETRY_ATTEMPTS: 4,
    NEVER_STARTED_CEILING_MS: 75000,
    ROOM_STALL_MS: 15000,
    SLOW_LOAD_MS: 10000,
    STUCK_AUTORETRY_MS: 20000,
    GENUINE_FAILURE_WINDOW_MS: 30000,
  };
  const source = readFileSync(
    new URL("../src/views/player/hooks/use-auto-retry.ts", import.meta.url),
    "utf8",
  );
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module: any = {};
  new Function("require", "exports", "window", "console", compiled)(
    (id: string) => (id === "react" ? react : dependencies),
    module,
    {
      setTimeout: (run: () => void, delay: number) => {
        timeouts.set(++timer, { run, delay });
        return timer;
      },
      clearTimeout: (id: number) => timeouts.delete(id),
      setInterval: () => ++timer,
      clearInterval() {},
    },
    { warn() {} },
  );
  let params: any = {
    src: { url: "https://media.test/a.mkv", meta: { id: "tt100", type: "movie" }, subtitles: [] },
    snap: { ...emptySnapshot, status: "loading" },
    bridgeRef,
    stremioServerTranscode: true,
    instantPlay: true,
    inRoom: false,
    debrids: [],
    selfFrameReadyRef: { current: false },
    openPicker: (...args: any[]) => pickers.push(args),
    engineFailure: false,
    isP2pEngine: false,
    engineStats: null,
  };
  let result: any;
  const render = (patch: any = {}) => {
    params = { ...params, ...patch };
    ri = si = mi = ei = 0;
    pending = [];
    result = module.useAutoRetry(params);
    for (const e of pending) effects[e.i]?.cleanup?.();
    for (const e of pending) effects[e.i] = { deps: e.deps, cleanup: e.run() };
    return result;
  };
  const fail = () => render({ snap: { ...emptySnapshot, status: "error", errorCode: "decode" } });
  const cycle = () => {
    render({ snap: { ...emptySnapshot, status: "loading" } });
    fail();
  };
  render();
  return {
    render,
    fail,
    cycle,
    bridge,
    bridgeRef,
    makeBridge,
    proxyRequests,
    debridRequests,
    probes,
    pickers,
    cleared,
    actorCurrent: (current: boolean) => {
      actorCurrent = current;
    },
    runTimeouts: (minimumDelay: number) => {
      for (const [id, timeout] of timeouts) {
        if (timeout.delay < minimumDelay) continue;
        timeouts.delete(id);
        timeout.run();
      }
    },
    pendingTimeouts: () => [...timeouts.values()],
    get params() {
      return params;
    },
    clock: (pos: number) => {
      position = pos;
    },
    next: (url = "https://media.test/b.mkv") =>
      render({
        src: { ...params.src, url, meta: { id: "tt200", type: "movie" } },
        snap: { ...emptySnapshot, status: "loading" },
      }),
    unmount: () => {
      for (const effect of effects) effect.cleanup?.();
    },
  };
}

function resumedSource(h: ReturnType<typeof recoveryHarness>) {
  const src = h.params.src;
  return {
    ...src,
    startPositionMs: 45000,
    continuation: {
      id: "saved-session",
      actor: { profileId: "one", storageProfileId: "one", accountId: "fixture-account" },
      positionMs: 45000,
      sourceKey: playbackSourceKey(src),
      target: { metaId: src.meta.id },
      source: { url: src.url, savedAt: 1 },
      audioTrack: { lang: "ara", title: "Arabic" },
      subtitle: { off: true },
      subDelaySec: 1.25,
      audioDelaySec: -0.2,
    },
  };
}

test("a valid resumed direct stream starts without a probe or source picker", () => {
  const h = recoveryHarness();
  h.render({ src: resumedSource(h), instantPlay: false });
  h.render({ snap: { ...emptySnapshot, status: "playing", firstFrameReady: true } });
  assert.equal(h.pickers.length, 0);
  assert.equal(h.proxyRequests.length, 0);
  assert.equal(h.probes.length, 0);
  assert.equal(h.cleared.length, 0);
});

test("failed direct continuation refreshes its picker once with the complete saved session", () => {
  const h = recoveryHarness();
  const src = resumedSource(h);
  h.render({ src, instantPlay: false });
  h.clock(45);
  h.fail();
  assert.equal(h.pickers.length, 1, "a seek position does not prove a decoded frame");
  assert.deepEqual(h.pickers[0], [
    src.meta,
    src.episode,
    {
      autoPlay: false,
      resume: true,
      continuation: src.continuation,
      queueItemId: undefined,
    },
  ]);
  assert.deepEqual(h.cleared, [[src.meta, src.episode]]);
  assert.equal(h.bridge.destroyed, 1);
  assert.equal(h.proxyRequests.length, 0);
  h.cycle();
  assert.equal(h.pickers.length, 1, "the same failed opening never repeats recovery");
});

test("a stale actor or mismatched continuation cannot reopen its picker", () => {
  for (const changed of ["actor", "target"] as const) {
    const h = recoveryHarness();
    const src = resumedSource(h);
    if (changed === "actor") h.actorCurrent(false);
    else src.continuation.target.metaId = "another-title";
    h.render({ src, instantPlay: false });
    h.fail();
    assert.equal(h.pickers.length, 0);
    assert.equal(h.bridge.loads.length, 0);
    assert.equal(h.proxyRequests.length, 0);
  }
});

test("a direct continuation that decoded a frame keeps ordinary mid-playback failure handling", () => {
  const h = recoveryHarness();
  h.render({ src: resumedSource(h), instantPlay: false });
  h.render({ snap: { ...emptySnapshot, status: "playing", firstFrameReady: true } });
  h.clock(45);
  h.fail();
  assert.equal(h.pickers.length, 0);
});

test("a terminal startup timeout recovers a direct continuation with its saved state", () => {
  const h = recoveryHarness();
  const src = resumedSource(h);
  h.render({ src, instantPlay: false });
  h.clock(45);
  h.runTimeouts(70000);
  h.render();
  assert.equal(h.pickers.length, 1);
  assert.equal(h.pickers[0][2].continuation, src.continuation);
  assert.equal(h.pickers[0][2].autoPlay, false);
});

test("a previous source's terminal error cannot dismiss a fresh direct continuation", () => {
  const h = recoveryHarness();
  h.render({ instantPlay: false });
  h.runTimeouts(70000);
  assert.ok(h.render().sourceError);
  const src = resumedSource(h);
  h.render({ src, snap: { ...emptySnapshot, status: "loading" } });
  assert.equal(h.pickers.length, 0);
  assert.equal(h.bridge.destroyed, 0);
});

test("a replaced continuation ignores the prior opening's queued startup deadline", () => {
  const h = recoveryHarness();
  const first = resumedSource(h);
  h.render({ src: first, instantPlay: false });
  const oldDeadline = h.pendingTimeouts().find((timer) => timer.delay > 70000)!;
  const next = { ...first, continuation: { ...first.continuation, id: "new-session" } };
  h.render({ src: next, snap: { ...emptySnapshot, status: "loading" } });
  oldDeadline.run();
  assert.equal(h.render().sourceError, null);
  assert.equal(h.pickers.length, 0);
});

test("a new continuation on the same URL receives its own recovery attempt", () => {
  const h = recoveryHarness();
  const first = resumedSource(h);
  h.render({ src: first, instantPlay: false });
  h.fail();
  h.bridgeRef.current = h.makeBridge();
  const next = { ...first, continuation: { ...first.continuation, id: "new-session" } };
  h.render({ src: next, snap: { ...emptySnapshot, status: "loading" } });
  h.fail();
  assert.equal(h.pickers.length, 2);
  assert.equal(h.pickers[1][2].continuation, next.continuation);
});

test("server, local, proxy, torrent, live and room sources keep their existing recovery paths", () => {
  for (const mode of ["server", "local", "proxy", "torrent", "live", "room"] as const) {
    const h = recoveryHarness();
    const src: any = resumedSource(h);
    if (mode === "server")
      src.homeServer = { connectionId: "one", itemId: "two", versionId: "three" };
    if (mode === "local") src.url = "C:/fixture/video.mkv";
    if (mode === "proxy") src.proxySessionId = "fixture-proxy";
    if (mode === "torrent") src.streamRef = { infoHash: "fixture-hash", fileIdx: 1 };
    if (mode === "live") src.meta = { ...src.meta, id: "iptv:fixture" };
    src.continuation = {
      ...src.continuation,
      target: { metaId: src.meta.id },
      sourceKey: playbackSourceKey(src),
    };
    h.render({ src, instantPlay: false, inRoom: mode === "room" });
    h.fail();
    assert.equal(h.pickers.length, 0, mode);
    assert.equal(h.cleared.length, 0, mode);
  }
});

test("an old proxy failure cannot act after a direct continuation opens its picker", async () => {
  const h = recoveryHarness();
  h.fail();
  h.cycle();
  const old = h.proxyRequests[0].job;
  const src = resumedSource(h);
  h.render({ src, instantPlay: false, snap: { ...emptySnapshot, status: "loading" } });
  h.fail();
  assert.equal(h.pickers.length, 1);
  old.reject(new Error("fixture old proxy failed"));
  await settle();
  assert.equal(h.pickers.length, 1);
  assert.equal(h.bridge.destroyed, 1);
});

async function settle() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

for (const rejected of [false, true]) {
  test(`old proxy ${rejected ? "failure" : "response"} cannot replace the user's next source`, async () => {
    const h = recoveryHarness();
    h.fail();
    h.cycle();
    assert.equal(h.proxyRequests.length, 1);
    const old = h.proxyRequests[0].job;
    h.next();
    if (rejected) old.reject(new Error("proxy unavailable"));
    else old.resolve({ url: "https://proxy.test/old" });
    await settle();
    assert.equal(h.bridge.loads.length, 1, "only the earlier same-URL retry should have loaded");
    assert.equal(h.bridge.destroyed, 0);
    assert.equal(h.pickers.length, 0, "old errors must not open the old title's picker");
  });
}

test("late proxy response cannot load a replacement bridge", async () => {
  const h = recoveryHarness();
  h.fail();
  h.cycle();
  const replacement = h.makeBridge();
  h.bridgeRef.current = replacement;
  h.proxyRequests[0].job.resolve({ url: "https://proxy.test/old" });
  await settle();
  assert.equal(replacement.loads.length, 0);
});

test("unmount cancels debrid resolution and ignores its late result", async () => {
  const h = recoveryHarness();
  h.render({ src: { ...h.params.src, streamRef: { infoHash: "fixture-hash" } }, debrids: [{}] });
  h.fail();
  const request = h.debridRequests[0];
  assert.ok(request);
  h.unmount();
  assert.equal(request.args[4].aborted, true);
  request.job.resolve({ ok: true, via: "fixture", data: { url: "https://debrid.test/old" } });
  await settle();
  assert.equal(h.bridge.loads.length, 0);
});

test("source changes during debrid header proxy setup cannot load the old stream", async () => {
  const h = recoveryHarness();
  h.render({ src: { ...h.params.src, streamRef: { infoHash: "fixture-hash" } }, debrids: [{}] });
  h.fail();
  h.debridRequests[0].job.resolve({
    ok: true,
    via: "fixture",
    data: { url: "https://debrid.test/old", headers: { "X-Fixture": "test" } },
  });
  await settle();
  assert.equal(h.proxyRequests.length, 1);
  h.next();
  h.proxyRequests[0].job.resolve({ url: "https://proxy.test/old" });
  await settle();
  assert.equal(h.bridge.loads.length, 0);
});

test("late remux response cannot replace a new source with the same URL", async () => {
  const h = recoveryHarness();
  h.fail();
  h.cycle();
  h.proxyRequests[0].job.resolve({ url: "https://proxy.test/a" });
  await settle();
  h.cycle();
  assert.equal(h.proxyRequests.length, 2);
  assert.deepEqual(h.proxyRequests[1].args[2], { transcode: true });
  h.next(h.params.src.url);
  h.proxyRequests[1].job.resolve({ url: "https://proxy.test/remux-old" });
  await settle();
  assert.equal(h.bridge.loads.length, 2);
});

test("late server probe cannot destroy a new player or select old transcoding", async () => {
  const h = recoveryHarness();
  h.render({ src: { ...h.params.src, url: "http://127.0.0.1:11470/a" } });
  h.fail();
  h.cycle();
  assert.equal(h.probes.length, 1);
  h.next();
  h.probes[0].resolve(true);
  await settle();
  assert.equal(h.bridge.destroyed, 0);
  assert.equal(h.render().transcodedUrl, null);
});

test("normal proxy recovery still loads the current source", async () => {
  const h = recoveryHarness();
  h.fail();
  h.cycle();
  h.proxyRequests[0].job.resolve({ url: "https://proxy.test/current" });
  await settle();
  assert.equal(h.bridge.loads.at(-1)?.url, "https://proxy.test/current");
});

test("proxy failure still advances automatic playback for the current source", async () => {
  const h = recoveryHarness();
  h.fail();
  h.cycle();
  h.proxyRequests[0].job.reject(new Error("proxy unavailable"));
  await settle();
  assert.equal(h.pickers.length, 1);
  assert.equal(h.pickers[0][0].id, "tt100");
  assert.equal(h.bridge.destroyed, 1);
});

test("playback that recovered while a proxy was pending is not interrupted", async () => {
  const h = recoveryHarness();
  h.fail();
  h.cycle();
  h.clock(30);
  h.render({ snap: { ...emptySnapshot, status: "playing", firstFrameReady: true } });
  h.proxyRequests[0].job.resolve({ url: "https://proxy.test/stale" });
  await settle();
  assert.equal(h.bridge.loads.length, 1);
});

test("normal debrid recovery retains the resolved URL and stream format", async () => {
  const h = recoveryHarness();
  h.render({ src: { ...h.params.src, streamRef: { infoHash: "fixture-hash" } }, debrids: [{}] });
  h.fail();
  h.debridRequests[0].job.resolve({
    ok: true,
    via: "fixture",
    data: { url: "https://debrid.test/current", notWebReady: true },
  });
  await settle();
  assert.deepEqual(h.bridge.loads[0], {
    url: "https://debrid.test/current",
    subtitles: [],
    notWebReady: true,
  });
});

test("a rejected debrid request falls back only while its source is current", async () => {
  for (const leave of [false, true]) {
    const h = recoveryHarness();
    h.render({ src: { ...h.params.src, streamRef: { infoHash: "fixture-hash" } }, debrids: [{}] });
    h.fail();
    if (leave) h.unmount();
    h.debridRequests[0].job.reject(new Error("debrid unavailable"));
    await settle();
    assert.equal(h.pickers.length, leave ? 0 : 1);
    assert.equal(h.bridge.destroyed, leave ? 0 : 1);
  }
});

test("server transcoding still activates for the current failed source", async () => {
  const h = recoveryHarness();
  h.render({ src: { ...h.params.src, url: "http://127.0.0.1:11470/a" } });
  h.fail();
  h.cycle();
  h.probes[0].resolve(true);
  await settle();
  assert.equal(h.bridge.destroyed, 1);
  assert.equal(h.render().transcodedUrl, "transcode:http://127.0.0.1:11470/a");
});

test("manual source recovery failure does not silently choose another title or stream", async () => {
  const h = recoveryHarness();
  h.render({ instantPlay: false });
  h.fail();
  h.cycle();
  h.proxyRequests[0].job.reject(new Error("proxy unavailable"));
  await settle();
  assert.equal(h.pickers.length, 0);
  assert.equal(h.bridge.destroyed, 0);
  assert.equal(h.render().sourceError?.host, "media.test");
});

test("showing an ordinary manual source error does not restart its recovery effect", async () => {
  const h = recoveryHarness();
  h.render({ instantPlay: false });
  h.fail();
  h.cycle();
  h.proxyRequests[0].job.reject(new Error("fixture proxy unavailable"));
  await settle();
  assert.ok(h.render().sourceError);
  assert.equal(h.proxyRequests.length, 1, "a visible error does not start another remux request");
  assert.equal(h.pickers.length, 0);
});

test("a failure after playback started is not auto-retried", () => {
  const h = recoveryHarness();
  h.render({ snap: { ...emptySnapshot, status: "playing", positionSec: 10 } });
  h.fail();
  assert.equal(h.bridge.loads.length, 0, "no same-URL reload");
  assert.equal(h.proxyRequests.length, 0, "no proxy retry");
  assert.equal(h.pickers.length, 0, "no source switch");
});

test("slow first frames before playback starts are not reported as a dead source", () => {
  const h = recoveryHarness();
  const realNow = Date.now;
  let now = realNow();
  Date.now = () => now;
  try {
    const playing = {
      ...emptySnapshot,
      status: "playing",
      firstFrameReady: false,
      videoWidth: 0,
      videoHeight: 0,
    };
    h.render({ instantPlay: false, snap: playing });
    now += 20_000;
    // Re-run the black-screen watch without changing what the player is doing.
    h.render({ src: { ...h.params.src, subtitles: [] }, snap: { ...playing } });
    assert.equal(h.render().sourceError, null);
  } finally {
    Date.now = realNow;
  }
});

test("a source error raised during playback clears when the stream is running", () => {
  const h = recoveryHarness();
  const realNow = Date.now;
  let now = realNow();
  Date.now = () => now;
  try {
    h.clock(30);
    const playing = {
      ...emptySnapshot,
      status: "playing",
      firstFrameReady: true,
      videoWidth: 0,
      videoHeight: 0,
    };
    h.render({ instantPlay: false, snap: playing });
    now += 20_000;
    h.render({ src: { ...h.params.src, subtitles: [] }, snap: { ...playing } });
    assert.equal(h.render().sourceError?.status, 0);
    assert.equal(h.render().sourceError, null);
  } finally {
    Date.now = realNow;
  }
});
