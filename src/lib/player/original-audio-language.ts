import type { Meta } from "@/lib/cinemeta";
import { tmdbIdFromImdb } from "@/lib/providers/tmdb/tmdb-imdb-resolve";
import { get } from "@/lib/providers/tmdb/tmdb-client";
import { normalizeLang } from "@/lib/subtitles/language";

const cache = new Map<string, string | null>();
const inflight = new Map<string, Promise<string | null>>();

export function audioLanguageOrder(
  preferred: string[],
  originalLanguage: string | null | undefined,
  rememberedLanguage?: string | null,
): string[] {
  const candidates = [rememberedLanguage, originalLanguage, ...preferred];
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const candidate of candidates) {
    const normalized = normalizeLang(candidate);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    ordered.push(normalized);
  }
  return ordered;
}

export async function resolveOriginalAudioLanguage(
  key: string,
  meta: Meta,
): Promise<string | null> {
  const embedded = normalizeLang(meta.originalLanguage);
  if (embedded) return embedded;
  if (!key) return null;

  const cacheKey = `${meta.type}:${meta.id}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey) ?? null;
  const pending = inflight.get(cacheKey);
  if (pending) return pending;

  const request = (async () => {
    let tmdbId = meta.id.match(/^tmdb:(movie|tv):(\d+)$/)?.[0] ?? null;
    if (!tmdbId && meta.id.startsWith("tt")) {
      tmdbId = await tmdbIdFromImdb(
        key,
        meta.id,
        meta.type === "series" || meta.type === "tv" ? "series" : "movie",
      );
    }
    const match = tmdbId?.match(/^tmdb:(movie|tv):(\d+)$/);
    if (!match) return null;
    const raw = await get<{ original_language?: string }>(key, `${match[1]}/${match[2]}`);
    return normalizeLang(raw?.original_language) || null;
  })()
    .catch(() => null)
    .then((language) => {
      cache.set(cacheKey, language);
      return language;
    })
    .finally(() => inflight.delete(cacheKey));
  inflight.set(cacheKey, request);
  return request;
}
