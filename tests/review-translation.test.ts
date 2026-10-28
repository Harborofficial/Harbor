import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function loadTranslation(safeFetch: (url: string) => Promise<Response>) {
  const mocks: Record<string, unknown> = {
    "@/lib/ai-models": {
      DEFAULT_AI_MODEL: "fixture",
      migrateModelId: (id: string) => id,
      supportsSampling: () => true,
    },
    "@/lib/config/endpoints": { HARBOR_API_BASE: "https://example.invalid" },
    "@/lib/i18n": { LANGUAGES: [{ code: "ar", label: "Arabic" }] },
    "@/lib/safe-fetch": { safeFetch },
  };
  const source = readFileSync("src/lib/review-translation.ts", "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {} as typeof import("../src/lib/review-translation");
  new Function("require", "exports", compiled)((name: string) => {
    assert.ok(name in mocks, `unexpected import ${name}`);
    return mocks[name];
  }, exports);
  return exports;
}

/** A Google translate stub: answers "ar:<text>" and records what it was sent. */
function google(respond?: (q: string, call: number) => Response | Promise<Response>) {
  const sent: string[] = [];
  let calls = 0;
  const fetch = async (url: string) => {
    const q = new URL(url).searchParams.get("q") ?? "";
    sent.push(q);
    const custom = await respond?.(q, calls++);
    return custom ?? new Response(JSON.stringify([[[`ar:${q}`, q]]]));
  };
  return { fetch, sent };
}

const rejoin = (chunks: { text: string; glue: string }[]) =>
  chunks.map((c) => c.glue + c.text).join("");

test("without an AI key, reviews go through Google and are cached", async () => {
  const g = google();
  const { translateReviews, cachedReviewTranslation } = loadTranslation(g.fetch);

  assert.deepEqual(await translateReviews(["Great film", "  "], "ar", null), [
    "ar:Great film",
    null,
  ]);
  assert.equal(cachedReviewTranslation("Great film", "ar"), "ar:Great film");

  await translateReviews(["Great film"], "ar", null);
  assert.equal(g.sent.length, 1);
});

test("a translation that keeps failing comes back as null", async () => {
  const { translateReviews } = loadTranslation(async () => new Response("", { status: 403 }));
  assert.deepEqual(await translateReviews(["Slow but rewarding"], "ar", null), [null]);
});

test("rate limits and server errors are retried a bounded number of times", async () => {
  const g = google((_, call) =>
    call < 2 ? new Response("", { status: call ? 503 : 429 }) : undefined!,
  );
  const { translateReviews } = loadTranslation(g.fetch);
  assert.deepEqual(await translateReviews(["Tense"], "ar", null), ["ar:Tense"]);
  assert.equal(g.sent.length, 3);

  const always = google(() => new Response("", { status: 429 }));
  const second = loadTranslation(always.fetch);
  assert.deepEqual(await second.translateReviews(["Tense"], "ar", null), [null]);
  assert.equal(always.sent.length, 3, "one try and two retries");
});

for (const [script, sample] of [
  ["Arabic", "هذه الحلقة تبني التوتر ببطء ثم تنفجر في النهاية بشكل رائع. "],
  ["Chinese", "这一集节奏缓慢但结尾非常精彩，演员的表演也很出色。"],
  ["Japanese", "このエピソードはゆっくりと緊張を高め、最後に見事に爆発する。"],
  ["Cyrillic", "Эта серия медленно нагнетает напряжение и блестяще разряжает его в финале. "],
  ["emoji", "Loved it 😭🔥👨‍👩‍👧 best episode ever!! "],
] as const) {
  test(`long ${script} reviews are split by their encoded length`, () => {
    const { translationChunks, GOOGLE_QUERY_BUDGET } = loadTranslation(
      async () => new Response(""),
    );
    const text = sample.repeat(Math.ceil(12_000 / sample.length)).trim();
    const chunks = translationChunks(text);
    assert.ok(chunks.length > 1);
    for (const chunk of chunks) {
      assert.ok(encodeURIComponent(chunk.text).length <= GOOGLE_QUERY_BUDGET);
      // No lone surrogate: every piece encodes, so no emoji or CJK character was cut in half.
      assert.doesNotThrow(() => encodeURIComponent(chunk.text));
    }
    assert.equal(rejoin(chunks), text);
  });
}

test("cuts prefer sentence ends, then spaces, and keep paragraph breaks", () => {
  const { translationChunks } = loadTranslation(async () => new Response(""));
  const sentence = "This episode builds tension slowly and pays it off. ";
  const long = sentence.repeat(120).trim();
  const text = `Short opening.\n\n${long}\n\nShort ending.`;
  const chunks = translationChunks(text);
  assert.equal(rejoin(chunks), text);
  assert.ok(chunks.slice(0, -1).every((c) => /[.]$/.test(c.text)));
  assert.ok(chunks.some((c) => c.glue === "\n\n"));

  const word = "x".repeat(5000);
  const cut = translationChunks(word);
  assert.ok(cut.length > 1);
  assert.equal(rejoin(cut), word);
});

test("short paragraphs still share a request", () => {
  const { translationChunks } = loadTranslation(async () => new Response(""));
  assert.deepEqual(translationChunks("One.\n\nTwo."), [{ text: "One.\n\nTwo.", glue: "" }]);
});

test("a chunk rejected as too long is sent again in smaller pieces", async () => {
  const g = google((q) => (q.length > 300 ? new Response("", { status: 400 }) : undefined!));
  const { translateReviews } = loadTranslation(g.fetch);
  const text = "Ein Satz über die Folge. ".repeat(40).trim();
  const [translated] = await translateReviews([text], "ar", null);
  assert.ok(translated);
  assert.ok(
    g.sent.some((q) => q.length > 300),
    "the first try was the whole chunk",
  );
  assert.ok(g.sent.filter((q) => q.length <= 300).length > 1, "then smaller pieces");
});

test("Google requests run at most four at a time", async () => {
  let running = 0;
  let peak = 0;
  const { translateReviews } = loadTranslation(async (url) => {
    running++;
    peak = Math.max(peak, running);
    await new Promise((resolve) => setTimeout(resolve, 5));
    running--;
    const q = new URL(url).searchParams.get("q");
    return new Response(JSON.stringify([[[`ar:${q}`, q]]]));
  });
  const texts = Array.from({ length: 30 }, (_, i) => `Comment ${i}`);
  const result = await translateReviews(texts, "ar", null);
  assert.equal(result.filter(Boolean).length, 30);
  assert.ok(peak <= 4, `peak ${peak}`);
});

test("simultaneous translation calls share the four-request Google limit", async () => {
  let running = 0;
  let peak = 0;
  const { translateReviews } = loadTranslation(async (url) => {
    running++;
    peak = Math.max(peak, running);
    await new Promise((resolve) => setTimeout(resolve, 10));
    running--;
    const q = new URL(url).searchParams.get("q");
    return new Response(JSON.stringify([[[`ar:${q}`, q]]]));
  });
  await Promise.all([
    translateReviews(["a1", "a2", "a3", "a4"], "ar", null),
    translateReviews(["b1", "b2", "b3", "b4"], "ar", null),
  ]);
  assert.ok(peak <= 4, `peak ${peak}`);
});

test("CJK sentence boundaries and ZWJ emoji stay intact when chunking", () => {
  const { translationChunks } = loadTranslation(async () => new Response(""));
  const cjk = "第一句很好。第二句也很好！第三句仍然很好？".repeat(12);
  const cjkChunks = translationChunks(cjk, 120);
  assert.equal(rejoin(cjkChunks), cjk);
  assert.ok(cjkChunks.slice(0, -1).every((chunk) => /[。！？]$/u.test(chunk.text)));

  const family = "👨‍👩‍👧";
  const emoji = family.repeat(12);
  const budget = encodeURIComponent(family.repeat(2)).length;
  const emojiChunks = translationChunks(emoji, budget);
  assert.equal(rejoin(emojiChunks), emoji);
  assert.ok(emojiChunks.every((chunk) => chunk.text.replaceAll(family, "") === ""));
  assert.ok(emojiChunks.every((chunk) => !chunk.text.startsWith("‍") && !chunk.text.endsWith("‍")));
});

test("partial failures leave only the failed reviews null", async () => {
  const g = google((q) => (q.includes("bad") ? new Response("", { status: 403 }) : undefined!));
  const { translateReviews } = loadTranslation(g.fetch);
  assert.deepEqual(await translateReviews(["good one", "bad one", "good two"], "ar", null), [
    "ar:good one",
    null,
    "ar:good two",
  ]);
  // A failure isn't cached, so trying again asks again.
  await translateReviews(["bad one"], "ar", null);
  assert.equal(g.sent.filter((q) => q === "bad one").length, 2);
});

test("overlapping requests for the same review share one translation", async () => {
  const g = google();
  const { translateReviews } = loadTranslation(async (url) => {
    await new Promise((resolve) => setTimeout(resolve, 10));
    return g.fetch(url);
  });
  const [a, b] = await Promise.all([
    translateReviews(["Same review", "Other"], "ar", null),
    translateReviews(["Same review"], "ar", null),
  ]);
  assert.equal(a[0], "ar:Same review");
  assert.equal(b[0], "ar:Same review");
  assert.equal(g.sent.filter((q) => q === "Same review").length, 1);
});

test("the AI path falls back to Google for reviews its answer leaves out or mangles", async () => {
  const g = google();
  const { translateReviews } = loadTranslation(g.fetch);
  const original = globalThis.fetch;
  let aiCalls = 0;
  globalThis.fetch = (async () => {
    aiCalls++;
    // r1 is fine, r2 is missing its closing tag, r3 is absent.
    const content = "<r1>ترجمة أولى</r1>\n<r2>نص بلا نهاية";
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }));
  }) as typeof fetch;
  try {
    const result = await translateReviews(["first", "second", "third"], "ar", {
      key: "fixture",
      model: "",
      groq: false,
    });
    assert.deepEqual(result, ["ترجمة أولى", "ar:second", "ar:third"]);
    assert.equal(aiCalls, 1);
    assert.deepEqual(g.sent, ["second", "third"]);
  } finally {
    globalThis.fetch = original;
  }
});

test("an AI error sends every review to Google", async () => {
  const g = google();
  const { translateReviews } = loadTranslation(g.fetch);
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response("{}", { status: 401 })) as typeof fetch;
  try {
    const result = await translateReviews(["one", "two"], "ar", {
      key: "x",
      model: "",
      groq: true,
    });
    assert.deepEqual(result, ["ar:one", "ar:two"]);
  } finally {
    globalThis.fetch = original;
  }
});

test("the translation cache keeps a bounded number of entries", async () => {
  const { translateReviews, cachedReviewTranslation } = loadTranslation(google().fetch);
  const texts = Array.from({ length: 520 }, (_, i) => `review ${i}`);
  await translateReviews(texts, "ar", null);
  assert.equal(cachedReviewTranslation("review 0", "ar"), null, "the oldest entries go first");
  assert.equal(cachedReviewTranslation("review 519", "ar"), "ar:review 519");
});
