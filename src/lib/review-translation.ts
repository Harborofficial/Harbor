import { DEFAULT_AI_MODEL, migrateModelId, supportsSampling } from "@/lib/ai-models";
import { HARBOR_API_BASE } from "@/lib/config/endpoints";
import { LANGUAGES, type UiLanguage } from "@/lib/i18n";
import { safeFetch } from "@/lib/safe-fetch";

// Translates user reviews (Letterboxd, IMDb, Trakt). Uses the AI Search key when one is set, for
// translations that read naturally, and Google's public translate endpoint otherwise or when the
// model fails.

export type ReviewTranslationAi = { key: string; model: string; groq: boolean };

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GOOGLE_URL = "https://translate.googleapis.com/translate_a/single";
// Google takes the text in the query string, so a chunk is limited by its percent-encoded length:
// an Arabic letter is 6 bytes there and a CJK character 9. This budget is for `q` alone and keeps
// the whole URL well under the ~2K that the endpoint accepts.
export const GOOGLE_QUERY_BUDGET = 1800;
// A chunk Google rejects as too long is halved, at most this many times.
const MAX_SPLITS = 3;
const GOOGLE_CONCURRENCY = 4;
const GOOGLE_RETRIES = 2;
const RETRY_BASE_MS = 400;
const AI_BATCH = 8;
const CACHE_LIMIT = 500;

const languageName = Object.fromEntries(
  LANGUAGES.map(({ code, label }) => [code, label]),
) as Record<UiLanguage, string>;
// Insertion-ordered, so the oldest entry is the first key: a small LRU.
const cache = new Map<string, string>();
const inFlight = new Map<string, Promise<string | null>>();

// A process-wide gate, not one pool per translateReviews() call. Individual review buttons,
// Translate all, and other review sections can overlap, but Google still sees at most four
// requests from Harbor at once.
let googleActive = 0;
const googleWaiters: Array<() => void> = [];
async function withGoogleSlot<T>(task: () => Promise<T>): Promise<T> {
  if (googleActive < GOOGLE_CONCURRENCY) googleActive++;
  else await new Promise<void>((resolve) => googleWaiters.push(resolve));
  try {
    return await task();
  } finally {
    const next = googleWaiters.shift();
    if (next) next();
    else googleActive--;
  }
}
const cacheKey = (text: string, to: UiLanguage) => `${to}\u0000${text}`;

export function cachedReviewTranslation(text: string, to: UiLanguage): string | null {
  const key = cacheKey(text, to);
  const hit = cache.get(key);
  if (hit == null) return null;
  cache.delete(key);
  cache.set(key, hit);
  return hit;
}

function remember(text: string, to: UiLanguage, translated: string): void {
  const key = cacheKey(text, to);
  cache.delete(key);
  cache.set(key, translated);
  while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
}

export type Chunk = { text: string; glue: string };

const encodedLength = (text: string) => encodeURIComponent(text).length;
const SENTENCE_END = /[.!?…。！？؟]["'”’)\]」』]*$/u;

const graphemes = (text: string): string[] => {
  if (typeof Intl.Segmenter === "function") {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    return Array.from(segmenter.segment(text), ({ segment }) => segment);
  }
  // Older WebViews still avoid splitting surrogate pairs; modern ones take the grapheme path.
  return Array.from(text);
};

// Cuts a paragraph that is over the budget into pieces that fit: at a sentence end, else at a
// space, else between grapheme clusters. This keeps ZWJ emoji and combining sequences intact.
// `glue` is the whitespace the piece was cut at, to put the pieces back together.
function splitParagraph(paragraph: string, budget: number): Chunk[] {
  const out: Chunk[] = [];
  let rest = graphemes(paragraph);
  let glue = "";
  while (encodedLength(rest.join("")) > budget) {
    // The longest prefix that fits.
    let lo = 1;
    let hi = rest.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (encodedLength(rest.slice(0, mid).join("")) <= budget) lo = mid;
      else hi = mid - 1;
    }
    const fit = lo;
    let cut = fit;
    // Prefer the last sentence end, then the last space, in the second half of what fits.
    // CJK sentences normally have no whitespace after 。！？, so sentence punctuation itself is
    // sufficient to establish a boundary.
    for (let i = fit; i > fit / 2; i--) {
      if (SENTENCE_END.test(rest.slice(0, i).join(""))) {
        cut = i;
        break;
      }
    }
    if (cut === fit) {
      for (let i = fit; i > fit / 2; i--) {
        if (/\s/u.test(rest[i] ?? "")) {
          cut = i;
          break;
        }
      }
    }
    out.push({ text: rest.slice(0, cut).join(""), glue });
    let next = cut;
    while (next < rest.length && /\s/u.test(rest[next]!)) next++;
    glue = rest.slice(cut, next).join("");
    rest = rest.slice(next);
  }
  out.push({ text: rest.join(""), glue });
  return out;
}

/** The pieces a review is sent to Google in; joining `glue + text` gives the review back. */
export function translationChunks(text: string, budget = GOOGLE_QUERY_BUDGET): Chunk[] {
  const out: Chunk[] = [];
  let current: Chunk | null = null;
  const parts = text.split(/(\n{2,})/);
  for (let i = 0; i < parts.length; i += 2) {
    const paragraph = parts[i]!;
    const glue = i ? parts[i - 1]! : "";
    if (encodedLength(paragraph) > budget) {
      if (current) out.push(current);
      current = null;
      const pieces = splitParagraph(paragraph, budget);
      pieces[0]!.glue = glue;
      out.push(...pieces);
      continue;
    }
    if (current && encodedLength(current.text + glue + paragraph) <= budget) {
      current = { text: current.text + glue + paragraph, glue: current.glue };
      continue;
    }
    if (current) out.push(current);
    current = { text: paragraph, glue };
  }
  if (current) out.push(current);
  return out;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type GoogleResult = { ok: true; text: string } | { ok: false; tooLong: boolean };

async function googleRequest(text: string, target: string): Promise<GoogleResult> {
  const params = new URLSearchParams({ client: "gtx", sl: "auto", tl: target, dt: "t", q: text });
  for (let attempt = 0; ; attempt++) {
    const res = await withGoogleSlot(() => safeFetch(`${GOOGLE_URL}?${params}`)).catch(() => null);
    if (res?.ok) {
      const data = (await res.json().catch(() => null)) as [Array<[string]>] | null;
      if (!Array.isArray(data?.[0])) return { ok: false, tooLong: false };
      return { ok: true, text: data[0].map((segment) => segment[0]).join("") };
    }
    const status = res?.status ?? 0;
    if (status === 400 || status === 413 || status === 414) return { ok: false, tooLong: true };
    // Rate limits, server errors and dropped connections get a couple of spaced-out retries.
    if (attempt >= GOOGLE_RETRIES || !(status === 0 || status === 429 || status >= 500))
      return { ok: false, tooLong: false };
    await sleep(RETRY_BASE_MS * 2 ** attempt);
  }
}

async function googleTranslate(text: string, to: UiLanguage): Promise<string | null> {
  // Google names Simplified Chinese "zh-CN".
  const target = to === "zh" ? "zh-CN" : to;
  const translateChunk = async (
    chunk: string,
    budget: number,
    splits: number,
  ): Promise<string | null> => {
    const result = await googleRequest(chunk, target);
    if (result.ok) return result.text;
    if (!result.tooLong || splits >= MAX_SPLITS) return null;
    // Rejected as too long after all: send it again in smaller pieces.
    let joined = "";
    for (const piece of translationChunks(chunk, Math.floor(budget / 2))) {
      const translated = await translateChunk(piece.text, Math.floor(budget / 2), splits + 1);
      if (translated == null) return null;
      joined += piece.glue + translated;
    }
    return joined;
  };
  let result = "";
  for (const chunk of translationChunks(text)) {
    const translated = await translateChunk(chunk.text, GOOGLE_QUERY_BUDGET, 0);
    if (translated == null) return null;
    result += chunk.glue + translated;
  }
  return result;
}

/** Runs `task` over the items with at most `limit` running at once. */
async function pool<T>(items: T[], limit: number, task: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await task(items[next++]!);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

async function aiTranslate(
  texts: string[],
  to: UiLanguage,
  ai: ReviewTranslationAi,
): Promise<(string | null)[]> {
  const model = migrateModelId(ai.model.trim()) || DEFAULT_AI_MODEL;
  const language = languageName[to];
  const headers: Record<string, string> = {
    Authorization: `Bearer ${ai.key.trim()}`,
    "Content-Type": "application/json",
  };
  if (!ai.groq) {
    headers["HTTP-Referer"] = HARBOR_API_BASE;
    headers["X-Title"] = "Harbor";
  }
  const res = await fetch(ai.groq ? GROQ_URL : OPENROUTER_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      ...(supportsSampling(model) ? { temperature: 0.2 } : {}),
      max_tokens: 6000,
      messages: [
        {
          role: "system",
          content: `You translate film and TV reviews into ${language}. Write natural, fluent ${language} the way a native critic would, keeping names, paragraph breaks, tone and meaning. Each review is wrapped in <rN>…</rN>; answer with every review translated inside the same tags and nothing else.`,
        },
        {
          role: "user",
          content: texts.map((text, i) => `<r${i + 1}>${text}</r${i + 1}>`).join("\n"),
        },
      ],
    }),
  }).catch(() => null);
  if (!res?.ok) return texts.map(() => null);
  const data = (await res.json().catch(() => null)) as {
    choices?: Array<{ message?: { content?: string } }>;
  } | null;
  const content = data?.choices?.[0]?.message?.content ?? "";
  // A malformed or partial answer leaves the missing reviews null, and Google takes them.
  return texts.map((_, i) => {
    const match = content.match(new RegExp(`<r${i + 1}>([\\s\\S]*?)</r${i + 1}>`));
    return match?.[1]?.trim() || null;
  });
}

async function translateUncached(
  texts: string[],
  to: UiLanguage,
  ai: ReviewTranslationAi | null,
): Promise<(string | null)[]> {
  const result: (string | null)[] = texts.map(() => null);
  if (ai?.key.trim()) {
    for (let start = 0; start < texts.length; start += AI_BATCH) {
      const translated = await aiTranslate(texts.slice(start, start + AI_BATCH), to, ai);
      translated.forEach((text, i) => (result[start + i] = text));
    }
  }
  const left = texts.map((_, i) => i).filter((i) => result[i] == null);
  await pool(left, GOOGLE_CONCURRENCY, async (i) => {
    result[i] = await googleTranslate(texts[i]!, to);
  });
  return result;
}

/** Translations for each text, in order; null where every translator failed. */
export async function translateReviews(
  texts: string[],
  to: UiLanguage,
  ai: ReviewTranslationAi | null,
): Promise<(string | null)[]> {
  const result = texts.map((text) => (text.trim() ? cachedReviewTranslation(text, to) : null));
  // A review already being translated (an overlapping "Translate all", say) is awaited, not
  // requested again.
  const waiting: Promise<void>[] = [];
  const fresh: string[] = [];
  const freshIndexes: number[][] = [];
  texts.forEach((text, i) => {
    if (result[i] != null || !text.trim()) return;
    const pending = inFlight.get(cacheKey(text, to));
    if (pending) {
      waiting.push(pending.then((translated) => void (result[i] = translated)));
      return;
    }
    const at = fresh.indexOf(text);
    if (at >= 0) freshIndexes[at]!.push(i);
    else {
      fresh.push(text);
      freshIndexes.push([i]);
    }
  });
  if (fresh.length) {
    const batch = translateUncached(fresh, to, ai);
    fresh.forEach((text, n) => {
      const one = batch.then((all) => all[n] ?? null);
      inFlight.set(cacheKey(text, to), one);
      waiting.push(
        one.then((translated) => {
          inFlight.delete(cacheKey(text, to));
          if (translated) remember(text, to, translated);
          for (const i of freshIndexes[n]!) result[i] = translated;
        }),
      );
    });
  }
  await Promise.all(waiting);
  return result;
}
