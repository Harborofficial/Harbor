import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import {
  shouldReportSpotifyStartupTimeout,
  SPOTIFY_STARTUP_TIMEOUT_MESSAGE,
  SPOTIFY_STARTUP_TIMEOUT_MS,
} from "../src/lib/music/spotify-startup.ts";

const track = { id: "spotify:track:fixture", connectorId: "spotify" };

test("Spotify startup timeout applies only to the current unresolved audio request", () => {
  const base = {
    request: 7,
    currentRequest: 7,
    expected: track,
    current: track,
    phase: "resolving",
    casting: false,
    videoOwned: false,
  };
  assert.equal(shouldReportSpotifyStartupTimeout(base), true);
  assert.equal(shouldReportSpotifyStartupTimeout({ ...base, currentRequest: 8 }), false);
  assert.equal(
    shouldReportSpotifyStartupTimeout({ ...base, current: { ...track, id: "new" } }),
    false,
  );
  assert.equal(shouldReportSpotifyStartupTimeout({ ...base, phase: "playing" }), false);
  assert.equal(shouldReportSpotifyStartupTimeout({ ...base, phase: "paused" }), false);
  assert.equal(shouldReportSpotifyStartupTimeout({ ...base, casting: true }), false);
  assert.equal(shouldReportSpotifyStartupTimeout({ ...base, videoOwned: true }), false);
  assert.equal(
    shouldReportSpotifyStartupTimeout({
      ...base,
      expected: { id: "other", connectorId: "soundcloud" },
    }),
    false,
  );
});

function watchdogHarness() {
  const source = readFileSync(new URL("../src/lib/music/player.ts", import.meta.url), "utf8");
  const ast = ts.createSourceFile("player.ts", source, ts.ScriptTarget.Latest, true);
  const declarations = ast.statements
    .filter(
      (node): node is ts.FunctionDeclaration =>
        ts.isFunctionDeclaration(node) &&
        ["armSpotifyStartupWatchdog", "clearSpotifyStartupWatchdog"].includes(
          node.name?.text ?? "",
        ),
    )
    .map((node) => node.getText(ast))
    .join("\n");
  const compiled = ts.transpileModule("let spotifyStartupTimer = null;\n" + declarations, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const timers = new Map<number, () => void>();
  let nextId = 0;
  const errors: string[] = [];
  const state = { current: track, phase: "resolving", error: null as string | null };
  const scope = {
    state,
    playRequest: 2,
    recoverPlayback: (message: string) => errors.push(message),
    shouldReportSpotifyStartupTimeout,
    SPOTIFY_STARTUP_TIMEOUT_MESSAGE,
    SPOTIFY_STARTUP_TIMEOUT_MS,
    getMusicSpeakerState: () => ({ active: false }),
    ownsMusicVideo: () => false,
    enginePrimed: true,
    publish: (patch: object) => Object.assign(state, patch),
    setTimeout(fn: () => void, ms: number) {
      assert.equal(ms, SPOTIFY_STARTUP_TIMEOUT_MS);
      const id = ++nextId;
      timers.set(id, fn);
      return id;
    },
    clearTimeout(id: number) {
      timers.delete(id);
    },
    console: { warn() {} },
  };
  const callbacks = new Function(
    ...Object.keys(scope),
    compiled + "\nreturn { armSpotifyStartupWatchdog, clearSpotifyStartupWatchdog };",
  )(...Object.values(scope)) as {
    armSpotifyStartupWatchdog(request: number, track: typeof track): void;
    clearSpotifyStartupWatchdog(): void;
  };
  return { ...callbacks, timers, errors, state };
}

test("a stalled Spotify play reports failure instead of loading forever", () => {
  const h = watchdogHarness();
  h.armSpotifyStartupWatchdog(2, track);
  assert.equal(h.timers.size, 1);
  [...h.timers.values()][0]();
  assert.deepEqual(h.errors, [SPOTIFY_STARTUP_TIMEOUT_MESSAGE]);
});

test("watchdog is canceled on an actual start, or when a newer request replaces it", () => {
  const h = watchdogHarness();
  h.armSpotifyStartupWatchdog(2, track);
  h.clearSpotifyStartupWatchdog();
  assert.equal(h.timers.size, 0);
  h.armSpotifyStartupWatchdog(2, track);
  h.armSpotifyStartupWatchdog(3, track);
  assert.equal(h.timers.size, 1);
  [...h.timers.values()][0]();
  assert.deepEqual(h.errors, []);
});

test("no timeout is scheduled once the Spotify track is already playing", () => {
  const h = watchdogHarness();
  h.state.phase = "playing";
  h.armSpotifyStartupWatchdog(2, track);
  assert.equal(h.timers.size, 0);
});
