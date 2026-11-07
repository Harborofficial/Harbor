import { LANGUAGES, type UiLanguage } from "@/lib/i18n";
import {
  translateReviews,
  translateWithAi,
  type ReviewTranslationAi,
} from "@/lib/review-translation";
import type { LyricLine } from "./lyrics";

// Lines are translated in blocks so the model sees enough context for slang and imagery.
const AI_BATCH = 20;
const CACHE_MAX = 16;

const cache = new Map<string, (string | null)[]>();

const cacheKey = (to: UiLanguage, texts: string[], ai: boolean): string =>
  `${to}\u0000${ai ? "ai" : "google"}\u0000${texts.join("\n")}`;

function instructions(to: UiLanguage): string {
  const language = LANGUAGES.find((entry) => entry.code === to)?.label ?? to;
  return `You translate song lyrics into ${language}. Many lyrics are Hindi or Urdu written in Latin letters (Hinglish); read those as Hindi/Urdu, not as English, and translate their meaning. Translate the entire line, including every word: never drop a part of the line or copy only the words already in ${language}. Write natural, emotionally faithful ${language} the way a native listener would read it, preserving tone, slang, imagery and the original line order. Keep artist names, song titles and place names as they are, but translate idioms and slang instead of transliterating them. Each line is wrapped in <rN>…</rN>. Return one translated line inside every tag and nothing outside the tags.`;
}

async function run(
  lines: LyricLine[],
  to: UiLanguage,
  ai: ReviewTranslationAi | null,
): Promise<(string | null)[]> {
  const texts = lines.map((line) => line.text);
  const result: (string | null)[] = texts.map(() => null);

  if (ai?.key.trim()) {
    for (let start = 0; start < texts.length; start += AI_BATCH) {
      const batch = texts.slice(start, start + AI_BATCH);
      const translated = await translateWithAi(batch, ai, instructions(to)).catch(() => []);
      translated.forEach((text, index) => (result[start + index] = text));
    }
  }

  const missing = texts
    .map((_, index) => index)
    .filter((index) => result[index] == null && texts[index]!.trim());
  if (missing.length) {
    const google = await translateReviews(
      missing.map((index) => texts[index]!),
      to,
      null,
    );
    google.forEach((text, index) => (result[missing[index]!] = text));
  }
  return result;
}

/** Translated lyric text for each line, in order; null where translation failed. */
export function translateLyrics(
  lines: LyricLine[],
  to: UiLanguage,
  ai: ReviewTranslationAi | null,
): Promise<(string | null)[]> {
  const texts = lines.map((line) => line.text);
  const key = cacheKey(to, texts, !!ai?.key.trim());
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return Promise.resolve(hit);
  }
  return run(lines, to, ai).then((result) => {
    // Never cache a failed or partial attempt; "Try again" must actually retry.
    const complete = lines.every((line, index) => !line.text.trim() || result[index] != null);
    if (complete) {
      cache.set(key, result);
      while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
    }
    return result;
  });
}
