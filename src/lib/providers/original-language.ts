import type { Meta } from "@/lib/cinemeta";
import { imdbapiOriginalLanguage } from "@/lib/providers/imdbapi/imdbapi-details";
import { get } from "@/lib/providers/tmdb/tmdb-client";
import { safeFetch } from "@/lib/safe-fetch";
import { isKnownLanguage, normalizeLang } from "@/lib/subtitles/language";

type OriginalLanguageInput = {
  meta: Pick<Meta, "id" | "type" | "originalLanguage">;
  imdbId: string | null;
  tmdbKey: string;
};

const tmdbCache = new Map<string, Promise<string>>();
const wikidataCache = new Map<string, Promise<string>>();

function cache(cached: Map<string, Promise<string>>, key: string, run: () => Promise<string>) {
  const hit = cached.get(key);
  if (hit) return hit;
  const pending = run().catch(() => "");
  if (cached.size >= 500) {
    const oldest = cached.keys().next();
    if (!oldest.done) cached.delete(oldest.value);
  }
  cached.set(key, pending);
  return pending;
}

/** TMDB's explicit `original_language`, cached for the session. */
function tmdbOriginalLanguage(input: OriginalLanguageInput): Promise<string> {
  if (!input.tmdbKey) return Promise.resolve("");
  const cached = cache(
    tmdbCache,
    `${input.meta.type}|${input.meta.id}|${input.imdbId ?? ""}`,
    async () => {
      if (input.meta.id.startsWith("tmdb:")) {
        const match = /^tmdb:(?:(movie|tv|series):)?(\d+)$/.exec(input.meta.id);
        if (!match) return "";
        const kind =
          match[1] === "tv" || match[1] === "series" || (!match[1] && input.meta.type === "series")
            ? "tv"
            : "movie";
        const raw = await get<Record<string, unknown>>(input.tmdbKey, `${kind}/${match[2]}`);
        return typeof raw?.original_language === "string" ? raw.original_language : "";
      }
      if (!input.imdbId?.startsWith("tt") && !input.meta.id.startsWith("tt")) return "";
      const imdbId = input.imdbId?.startsWith("tt") ? input.imdbId : input.meta.id;
      const find = await get<{
        movie_results?: Array<{ original_language?: string }>;
        tv_results?: Array<{ original_language?: string }>;
      }>(input.tmdbKey, `find/${imdbId}`, { external_source: "imdb_id" });
      const ordered =
        input.meta.type === "series"
          ? [find?.tv_results?.[0], find?.movie_results?.[0]]
          : [find?.movie_results?.[0], find?.tv_results?.[0]];
      const language = ordered.find((hit) => typeof hit?.original_language === "string");
      return language?.original_language ?? "";
    },
  );
  return cached;
}

const WIKIDATA_QUERY = `SELECT ?iso1 ?iso3 ?langLabel WHERE {
  ?title wdt:P345 "IMDB_ID" .
  ?title wdt:P364 ?lang .
  OPTIONAL { ?lang wdt:P218 ?iso1 . }
  OPTIONAL { ?lang wdt:P220 ?iso3 . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,mul" . }
} LIMIT 10`;

/** Wikidata's explicit "original language of film or TV series" (P364). */
function wikidataOriginalLanguage(imdbId: string): Promise<string> {
  if (!imdbId.startsWith("tt")) return Promise.resolve("");
  return cache(wikidataCache, imdbId, async () => {
    const query = WIKIDATA_QUERY.replace("IMDB_ID", imdbId);
    const res = await safeFetch(
      `https://query.wikidata.org/sparql?query=${encodeURIComponent(query)}&format=json`,
      { headers: { Accept: "application/sparql-results+json" } },
    );
    if (!res.ok) return "";
    const data = (await res.json()) as {
      results?: { bindings?: Array<Record<string, { value?: string } | undefined>> };
    };
    const languages = new Set<string>();
    for (const row of data.results?.bindings ?? []) {
      const raw = row.iso1?.value || row.iso3?.value || row.langLabel?.value || "";
      const code = normalizeLang(raw);
      if (isKnownLanguage(code)) languages.add(code);
    }
    // Several original languages mean "Original" has no single answer; the next
    // preference is a better choice than guessing one of them.
    return languages.size === 1 ? [...languages][0] : "";
  });
}

/**
 * The title's original language in trust order: an explicit metadata value,
 * TMDB's field when a key exists, Wikidata's explicit property, then IMDb only
 * when it lists a single spoken language (unambiguous).
 */
export async function resolveOriginalLanguage(input: OriginalLanguageInput): Promise<string> {
  if (input.meta.originalLanguage) return input.meta.originalLanguage;
  const tmdb = await tmdbOriginalLanguage(input);
  if (tmdb) return tmdb;
  const imdbId = input.imdbId?.startsWith("tt")
    ? input.imdbId
    : input.meta.id.startsWith("tt")
      ? input.meta.id
      : null;
  if (!imdbId) return "";
  const wikidata = await wikidataOriginalLanguage(imdbId);
  if (wikidata) return wikidata;
  return imdbapiOriginalLanguage(imdbId).catch(() => "");
}
