import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import type { Meta } from "../src/lib/cinemeta.ts";

type Actions = typeof import("../src/lib/movie-watched-action.ts");
const movie = { id: "tt123", type: "movie", name: "Fixture" } as Meta;

function harness() {
  const calls: Array<{ watched: boolean; options: Record<string, unknown> }> = [];
  let confirmed = true;
  let first: unknown = { outcomes: [{ provider: "Harbor", status: "updated" }] };
  let second: unknown = { outcomes: [{ provider: "Harbor", status: "updated" }] };
  const mocks: Record<string, unknown> = {
    "./confirm-action": { confirmAction: async () => confirmed },
    "./i18n": { t: (key: string) => key },
    "./media-context-actions": {
      setContextWatched: async (
        _meta: Meta,
        watched: boolean,
        options: Record<string, unknown>,
      ) => {
        calls.push({ watched, options });
        return options.allowSimklLibraryRemoval ? second : first;
      },
    },
  };
  const output = ts.transpileModule(
    readFileSync(new URL("../src/lib/movie-watched-action.ts", import.meta.url), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", output)(
    (name: string) => {
      assert.ok(name in mocks, name);
      return mocks[name];
    },
    module,
    module.exports,
  );
  return {
    actions: module.exports as Actions,
    calls,
    cancel: () => {
      confirmed = false;
    },
    results: (next: unknown, allowed: unknown) => {
      first = next;
      second = allowed;
    },
  };
}

test("movie unwatch asks once and retries with Simkl removal allowed", async () => {
  const h = harness();
  h.results(
    { confirmation: "simkl-library-removal", outcomes: [] },
    { outcomes: [{ provider: "Harbor", status: "updated" }] },
  );
  const result = await h.actions.setMovieWatchedWithConfirmation(movie, false, {
    title: "Fixture",
  });
  assert.deepEqual(
    h.calls.map((call) => call.options.allowSimklLibraryRemoval),
    [false, true],
  );
  assert.equal(h.calls[0]?.watched, false);
  assert.deepEqual(result, { outcomes: [{ provider: "Harbor", status: "updated" }] });
});

test("cancelling the Simkl confirmation makes no change", async () => {
  const h = harness();
  h.cancel();
  h.results({ confirmation: "simkl-library-removal", outcomes: [] }, {});
  const result = await h.actions.setMovieWatchedWithConfirmation(movie, false);
  assert.equal(result, null);
  assert.equal(h.calls.length, 1);
});

test("non-Simkl unwatch runs once without a prompt", async () => {
  const h = harness();
  const result = await h.actions.setMovieWatchedWithConfirmation(movie, false);
  assert.equal(h.calls.length, 1);
  assert.deepEqual(result, { outcomes: [{ provider: "Harbor", status: "updated" }] });
});

test("optimistic watched state clears both Stremio watched counters", () => {
  const { actions } = harness();
  const state = { timeOffset: 0, duration: 0, flaggedWatched: 1, timesWatched: 2 };
  assert.deepEqual(actions.optimisticMovieWatchedState(state, false), {
    ...state,
    flaggedWatched: 0,
    timesWatched: 0,
  });
  assert.deepEqual(actions.optimisticMovieWatchedState(state, true), {
    ...state,
    flaggedWatched: 1,
    timesWatched: 2,
  });
});
