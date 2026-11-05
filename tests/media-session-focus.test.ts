import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

type Session = typeof import("../src/lib/media-session");
type Call = { command: string; args?: Record<string, unknown> };
const settle = () => new Promise<void>(resolve => setImmediate(resolve));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fixture(options: {
  focused?: boolean;
  windows?: boolean;
  native?: boolean;
  focusQuery?: Promise<boolean>;
  registration?: Promise<void>;
  invoke?: (call: Call) => Promise<unknown>;
} = {}) {
  const calls: Call[] = [];
  const events = new Set<(event: { payload: { focused: boolean; minimized: boolean } }) => void>();
  let locked = false;
  let now = 1000;
  const mocks: Record<string, unknown> = {
    "@tauri-apps/api/core": { invoke: (command: string, args?: Record<string, unknown>) => {
      const call = { command, args };
      calls.push(call);
      return options.invoke?.(call) ?? Promise.resolve();
    } },
    "@tauri-apps/api/event": { listen: async (_name: string, handler: (event: any) => void) => {
      await options.registration;
      events.add(handler);
      return () => events.delete(handler);
    } },
    "@tauri-apps/api/window": { getCurrentWindow: () => ({
      isFocused: () => options.focusQuery ?? Promise.resolve(options.focused ?? true),
    }) },
    "@/lib/platform": { isWindowsDesktop: () => options.windows ?? true },
    "@/lib/player/interaction-lock": { isPlayerInteractionLocked: () => locked },
  };
  const source = readFileSync(new URL("../src/lib/media-session.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {} as Session;
  new Function("require", "exports", "window", "document", "Date", compiled)(
    (id: string) => { assert.ok(id in mocks, id); return mocks[id]; }, exports,
    options.native === false ? {} : { __TAURI_INTERNALS__: {} },
    { hasFocus: () => options.focused ?? true }, { now: () => now },
  );
  return {
    ...exports, calls,
    focus: (focused: boolean, minimized = false) => {
      for (const handler of events) handler({ payload: { focused, minimized } });
    },
    advance: (ms = 1000) => { now += ms; },
    lock: (value: boolean) => { locked = value; },
    listeners: () => events.size,
  };
}

test("paused music remains published on blur/minimize with metadata and seeking intact", async () => {
  const h = fixture();
  h.startMediaSessionWindowTracking();
  await settle();
  h.updateMediaControls(false, "Track", "Artist", null, 180, 12, .6, "music", "Album");
  await settle();
  h.focus(false, true);
  h.focus(false);
  h.updateMediaControls(false, "Next track", "Another artist", null, 200, 20, .7, "music", "Next album");
  h.notifyMediaSeeked(35);
  await settle();
  assert.deepEqual(h.calls.map(call => call.command),
    ["media_controls_update", "media_controls_update", "media_controls_seeked"]);
  assert.equal(h.calls[1].args?.title, "Next track");
  assert.equal(h.calls[1].args?.album, "Next album");
  assert.equal(h.calls[2].args?.positionSec, 35);
  assert.equal(h.mediaKeyGate("music"), true, "paused background music accepts media keys");
  assert.equal(h.mediaKeyGate("video"), false, "video cannot handle music session keys");
  h.focus(true);
  await settle();
  assert.equal(h.calls.length, 3, "refocusing does not unnecessarily republish media");
});

test("background pause retains the session; paused video keeps its existing media-key gate", async () => {
  const h = fixture();
  h.startMediaSessionWindowTracking();
  await settle();
  h.updateMediaControls(true, "Track", "Artist", null, 180, 12, .6, "music");
  h.focus(false, true);
  await settle();
  assert.equal(h.calls.length, 1);
  assert.equal(h.mediaKeyGate("music"), true);
  h.advance();
  h.updateMediaControls(false, "Track", "Artist", null, 180, 13, .6, "music");
  await settle();
  assert.equal(h.calls.at(-1)?.command, "media_controls_update");
  assert.equal(h.calls.at(-1)?.args?.playing, false);
  assert.equal(h.mediaKeyGate("music"), true, "background music can resume after pause");
  h.advance();
  h.updateMediaControls(false, "Video", "Episode", null, 180, 13);
  await settle();
  assert.equal(h.calls.at(-1)?.args?.mediaType, "video");
  assert.equal(h.mediaKeyGate("music"), false, "music cannot take video's keys");
  assert.equal(h.mediaKeyGate("video"), false, "paused unfocused video still declines keys");
  h.focus(true);
  h.advance();
  assert.equal(h.mediaKeyGate("video"), true);
});

test("the first paused music track loaded while unfocused registers immediately", async () => {
  const h = fixture({ focused: false });
  h.startMediaSessionWindowTracking();
  await settle();
  h.updateMediaControls(false, "Background track", "Artist", null, 90, 25, .5, "music");
  await settle();
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].args?.title, "Background track");
  assert.equal(h.mediaKeyGate("music"), true);
});

test("explicitly clearing a paused background session prevents focus from restoring it", async () => {
  const h = fixture();
  h.startMediaSessionWindowTracking();
  await settle();
  h.updateMediaControls(false, "Old session", "", null, 90, 10, .5, "music");
  h.focus(false);
  h.clearMediaControls();
  h.focus(true);
  await settle();
  assert.deepEqual(h.calls.map(call => call.command), ["media_controls_update", "media_controls_clear"]);
  assert.equal(h.mediaKeyGate("music"), false);
});

test("explicit clear waits for a pending update and a failed update does not block future sessions", async () => {
  const first = deferred<void>();
  let count = 0;
  const h = fixture({ invoke: () => ++count === 1 ? first.promise : Promise.resolve() });
  h.startMediaSessionWindowTracking();
  await settle();
  h.updateMediaControls(false, "Old", "", null, 90, 10, .5, "music");
  await settle();
  h.focus(false);
  h.clearMediaControls();
  await settle();
  assert.equal(h.calls.length, 1, "native clear waits for the in-flight update");
  first.reject(new Error("Native update failed"));
  await settle();
  assert.equal(h.calls[1].command, "media_controls_clear");
  h.updateMediaControls(false, "New", "", null, 90, 20, .5, "music");
  await settle();
  assert.equal(h.calls[2].command, "media_controls_update");
  assert.equal(h.calls[2].args?.title, "New");
});

test("a late initial native focus query does not override the latest blur", async () => {
  const query = deferred<boolean>();
  const h = fixture({ focusQuery: query.promise });
  h.startMediaSessionWindowTracking();
  await settle();
  h.updateMediaControls(false, "Paused", "", null, 90, 10);
  h.focus(false);
  query.resolve(true);
  await settle();
  assert.equal(h.mediaKeyGate("video"), false, "newer blur wins over stale focus query");
  assert.deepEqual(h.calls.map(call => call.command), ["media_controls_update"]);
});

test("tracking cleans up both registered and late-registering native listeners", async () => {
  const registration = deferred<void>();
  const h = fixture({ registration: registration.promise });
  const stop = h.startMediaSessionWindowTracking();
  stop();
  registration.resolve();
  await settle();
  assert.equal(h.listeners(), 0);
  const stopAgain = h.startMediaSessionWindowTracking();
  await settle();
  assert.equal(h.listeners(), 1);
  stopAgain();
  assert.equal(h.listeners(), 0);
});

test("Linux/macOS paused session behavior and web controls remain unchanged", async () => {
  const h = fixture({ windows: false, focused: false });
  h.startMediaSessionWindowTracking();
  h.updateMediaControls(false, "Track", "");
  await settle();
  assert.equal(h.listeners(), 0);
  assert.equal(h.calls[0].command, "media_controls_update");
  assert.equal(h.mediaKeyGate(), true);
  const web = fixture({ native: false, focused: false });
  web.updateMediaControls(false, "Track", "");
  await settle();
  assert.equal(web.calls.length, 0);
  assert.equal(web.mediaKeyGate(), true);
});

test("metadata/clock deduplication and media-key debounce survive focus handling", async () => {
  const h = fixture();
  h.updateMediaControls(true, "Track", "", null, 180, 10);
  h.advance();
  h.updateMediaControls(true, "Track", "", null, 180, 11);
  await settle();
  assert.equal(h.calls.length, 1);
  assert.equal(h.mediaKeyGate(), true);
  assert.equal(h.mediaKeyGate(), false);
  h.advance();
  h.updateMediaControls(true, "Track", "", null, 180, 50);
  await settle();
  assert.equal(h.calls.length, 2, "a seek still updates the native position");
});

test("music metadata and periodic Windows timeline updates reach native controls", async () => {
  const h = fixture();
  const art = "https://example.com/album.jpg";
  h.updateMediaControls(true, "Track", "Artist", art, 200, 10, .5, "music", "Album");
  await settle();
  assert.equal(h.calls[0].args?.mediaType, "music");
  assert.equal(h.calls[0].args?.album, "Album");
  assert.equal(h.calls[0].args?.artUrl, art);
  assert.equal(h.calls[0].args?.durationSec, 200);
  assert.equal(h.calls[0].args?.positionSec, 10);

  h.advance(4_000);
  h.updateMediaControls(true, "Track", "Artist", art, 200, 14, .5, "music", "Album");
  await settle();
  assert.equal(h.calls.length, 1, "ordinary clock ticks are deduplicated");

  h.advance(1_100);
  h.updateMediaControls(true, "Track", "Artist", art, 200, 15.1, .5, "music", "Album");
  await settle();
  assert.equal(h.calls.length, 2, "Windows position refreshes during continuous playback");
  assert.equal(h.calls[1].args?.positionSec, 15.1);

  h.updateMediaControls(true, "Track", "Artist", art, 200, 15.1, .5, "music", "New Album");
  await settle();
  assert.equal(h.calls[2].args?.album, "New Album");

  h.updateMediaControls(true, "Film", "Episode", null, 200, 15.1, .5);
  await settle();
  assert.equal(h.calls[3].args?.mediaType, "video", "video retains its own media type");
  assert.equal(h.calls[3].args?.album, null);
});

test("terminal video snapshots clear the session and late clock ticks cannot reopen it", () => {
  const source = readFileSync(new URL("../src/views/player.tsx", import.meta.url), "utf8");
  const tree = ts.createSourceFile("player.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let effect: ts.ArrowFunction | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText(tree) === "useEffect") {
      const callback = node.arguments[0];
      if (ts.isArrowFunction(callback) && callback.body.getText(tree).includes("updateMediaControls(")) effect = callback;
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  assert.ok(effect);
  const output = ts.transpileModule(`exports.run = ${effect.getText(tree)}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  for (const status of ["idle", "ended", "error", "paused", "playing"]) {
    const snap = { status, firstFrameReady: true, positionSec: 20, volume: .8, durationSec: 100 };
    const updates: unknown[][] = [];
    let clears = 0;
    let tick: (() => void) | undefined;
    const scope = {
      snap, snapRef: { current: snap }, src: { meta: { name: "Film" } },
      clearMediaControls: () => { clears++; },
      updateMediaControls: (...args: unknown[]) => updates.push(args),
      getPlaybackPosition: () => 20,
      subscribePlaybackClock: (callback: () => void) => { tick = callback; return () => {}; },
    };
    const exports = {} as { run: () => void };
    new Function(...Object.keys(scope), "exports", output)(...Object.values(scope), exports);
    exports.run();
    if (["idle", "ended", "error"].includes(status)) {
      assert.equal(clears, 1);
      assert.equal(updates.length, 0);
      assert.equal(tick, undefined);
    } else {
      assert.equal(updates.length, 1);
      snap.status = "ended";
      tick?.();
      assert.equal(clears, 1);
      assert.equal(updates.length, 1);
    }
  }
});

test("Windows SMTC activation is not repeated for timeline-only updates", () => {
  const rust = readFileSync(new URL("../src-tauri/src/media_controls.rs", import.meta.url), "utf8");
  const begin = rust.indexOf("    pub fn update(", rust.indexOf("mod win {"));
  const end = rust.indexOf("    pub fn seeked(", begin);
  assert.ok(begin > 0 && end > begin, "Windows SMTC update function must exist");
  const update = rust.slice(begin, end);

  assert.match(update, /if guard\.is_none\(\)\s*\{\s*smtc\.SetIsEnabled\(true\)\?/,
    "only newly published or explicitly cleared sessions should be enabled");
  assert.equal((update.match(/SetIsEnabled\(true\)/g) ?? []).length, 1);
  assert.match(update, /if status_changed\s*\{\s*smtc\.SetPlaybackStatus\(/);
  assert.match(update, /if metadata_changed\s*\{\s*let du = smtc\.DisplayUpdater\(\)/);
  assert.match(update, /if timeline_changed\s*\{\s*update_timeline\(/,
    "existing sessions must still receive timeline updates");
  assert.match(rust, /pub fn clear\(\)[\s\S]*?smtc\.SetIsEnabled\(false\)/,
    "explicit clear should release the SMTC session");
});
