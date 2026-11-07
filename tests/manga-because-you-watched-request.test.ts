import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function loadHook() {
  const source = readFileSync(
    new URL("../src/lib/manga/use-because-you-watched.ts", import.meta.url),
    "utf8",
  );
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const effects: Array<() => void | (() => void)> = [];
  let index = 0;
  const state: unknown[] = [];
  const calls = { adaptations: 0, searches: 0 };
  const mock: Record<string, any> = {
    react: {
      useState(initial: any) {
        const current = index++;
        if (!(current in state))
          state[current] = typeof initial === "function" ? initial() : initial;
        return [
          state[current],
          (next: any) => {
            state[current] = typeof next === "function" ? next(state[current]) : next;
          },
        ];
      },
      useEffect(effect: () => void | (() => void)) {
        effects.push(effect);
      },
    },
    "@/lib/playback-history": {
      playbackEntries: () => [{ metaId: "anilist:101", title: "JoJo", savedAt: 100 }],
    },
    "@/lib/manga/anime-adaptation": {
      resolveAnimeSourceManga: async () => {
        calls.adaptations++;
        return { title: "Steel Ball Run" };
      },
    },
    "@/lib/manga/sources": {
      activeMangaSourceId: () => "batcave",
      subscribeMangaSources: () => () => {},
    },
    "@/lib/manga/api": {
      searchManga: async () => {
        calls.searches++;
        return [{ id: "batcave::one", title: "Steel Ball Run" }];
      },
    },
  };
  const out: Record<string, any> = {};
  new Function("require", "exports", js)((name: string) => {
    assert.ok(name in mock, "Unexpected import: " + name);
    return mock[name];
  }, out);
  return {
    render(enabled: boolean) {
      index = 0;
      effects.length = 0;
      const result = out.useBecauseYouWatched(enabled);
      for (const effect of effects) effect();
      return result;
    },
    calls,
  };
}

test("manga recommendations do not query the current source just because anime is in Continue Watching", async () => {
  const h = loadHook();
  const result = h.render(false);
  assert.equal(result.hasHistory, true);
  assert.equal(result.loading, false);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.calls.adaptations, 0);
  assert.equal(h.calls.searches, 0);
});

test("manga adaptation lookup starts only after an explicit request", async () => {
  const h = loadHook();
  h.render(true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.calls.adaptations, 1);
  assert.equal(h.calls.searches, 1);
});
