import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

type LoadMocks = Record<string, unknown>;

function load(mocks: LoadMocks) {
  const source = readFileSync("src/lib/music/lyrics-translation.ts", "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {} as {
    translateLyrics: (
      lines: { at: number; text: string }[],
      to: string,
      ai: { key: string; model: string; groq: boolean } | null,
    ) => Promise<(string | null)[]>;
  };
  new Function("require", "exports", compiled)((name: string) => {
    assert.ok(name in mocks, `unexpected import ${name}`);
    return mocks[name];
  }, exports);
  return exports;
}

const LANGUAGES = [{ code: "en", label: "English" }];
const lines = [
  { at: 0, text: "Main Asli Mein Asli Hoon, No Cap" },
  { at: 4, text: "Beat'on Pe Jungli Hoon, No Cap" },
];

test("translated lyrics keep their line order and use the lyrics prompt", async () => {
  const calls: { texts: string[]; instructions: string }[] = [];
  const { translateLyrics } = load({
    "@/lib/i18n": { LANGUAGES },
    "@/lib/review-translation": {
      translateWithAi: async (texts: string[], _ai: unknown, instructions: string) => {
        calls.push({ texts, instructions });
        return texts.map((text) => `EN:${text}`);
      },
      translateReviews: async () => [],
    },
  });

  assert.deepEqual(await translateLyrics(lines, "en", { key: "key", model: "", groq: false }), [
    "EN:Main Asli Mein Asli Hoon, No Cap",
    "EN:Beat'on Pe Jungli Hoon, No Cap",
  ]);
  assert.deepEqual(
    calls[0]?.texts,
    lines.map((line) => line.text),
  );
  assert.match(calls[0]?.instructions ?? "", /Hinglish/);
  assert.match(calls[0]?.instructions ?? "", /Hindi or Urdu/);
});

test("missing AI lines fall back to Google translation", async () => {
  const { translateLyrics } = load({
    "@/lib/i18n": { LANGUAGES },
    "@/lib/review-translation": {
      translateWithAi: async () => [null, "AI second"],
      translateReviews: async (texts: string[]) => texts.map((text) => `G:${text}`),
    },
  });

  assert.deepEqual(await translateLyrics(lines, "en", { key: "key", model: "", groq: false }), [
    "G:Main Asli Mein Asli Hoon, No Cap",
    "AI second",
  ]);
});

test("a failed attempt is not cached, so Try again really retries", async () => {
  let calls = 0;
  const { translateLyrics } = load({
    "@/lib/i18n": { LANGUAGES },
    "@/lib/review-translation": {
      translateWithAi: async () => {
        calls += 1;
        return calls === 1 ? [null, null] : ["first", "second"];
      },
      translateReviews: async () => [null, null],
    },
  });

  assert.deepEqual(await translateLyrics(lines, "en", { key: "key", model: "", groq: false }), [
    null,
    null,
  ]);
  assert.deepEqual(await translateLyrics(lines, "en", { key: "key", model: "", groq: false }), [
    "first",
    "second",
  ]);
  assert.equal(calls, 2);
});

test("long lyrics are translated in context-sized batches", async () => {
  const texts = Array.from({ length: 45 }, (_, index) => `line ${index}`);
  let batches = 0;
  const { translateLyrics } = load({
    "@/lib/i18n": { LANGUAGES },
    "@/lib/review-translation": {
      translateWithAi: async (batch: string[]) => {
        batches += 1;
        return batch.map((text) => `EN:${text}`);
      },
      translateReviews: async () => [],
    },
  });

  const result = await translateLyrics(
    texts.map((text, index) => ({ at: index, text })),
    "en",
    { key: "key", model: "", groq: false },
  );
  assert.equal(batches, 3);
  assert.equal(result.length, 45);
});
