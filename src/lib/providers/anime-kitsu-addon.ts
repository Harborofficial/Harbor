import { lruGet, lruSet } from "@/lib/cache";
import { registerCache } from "@/lib/memory-profiler";
import { safeFetch } from "@/lib/safe-fetch";
import {
  loadMedia,
  episodeCacheTtl,
  onMediaCacheClear,
  mediaCacheGeneration,
} from "@/lib/media-cache";
import { sourceFingerprint } from "./source-fingerprint";

const HOST = "https://anime-kitsu.strem.fun";
const TTL = 6 * 60 * 60 * 1000;
const NEG_TTL = 30 * 60 * 1000;
const CACHE_MAX = 300;

const cache = new Map<
  string,
  { v: AnimeKitsuMeta | null; t: number; freshUntil: number; loadedAt: number }
>();
// See kitsu.ts: source identity must outlive the LRU that holds the payload.
const sourceIdentities = new Map<
  string,
  { revision: number; digest: string; freshUntil: number }
>();
let revision = 0;
const SOURCE_IDENTITY_MAX = 2000;
const inflight = new Map<string, Promise<AnimeKitsuMeta | null>>();

registerCache("anime-kitsu:meta", () => cache.size);
onMediaCacheClear(() => {
  cache.clear();
  sourceIdentities.clear();
  inflight.clear();
});

function rememberSource(key: string, value: AnimeKitsuMeta | null, freshUntil: number): void {
  const digest = sourceFingerprint(value);
  const previous = sourceIdentities.get(key);
  const sourceRevision = previous?.digest === digest ? previous.revision : ++revision;
  lruSet(
    sourceIdentities,
    key,
    { revision: sourceRevision, digest, freshUntil },
    SOURCE_IDENTITY_MAX,
  );
}

export type AnimeKitsuVideo = {
  id: string;
  title: string;
  released?: string;
  season: number;
  episode: number;
  thumbnail?: string;
  overview?: string;
  imdb_id?: string;
  imdbSeason?: number;
  imdbEpisode?: number;
};

export type AnimeKitsuLink = {
  name: string;
  category: string;
  url: string;
};

export type AnimeKitsuMeta = {
  id: string;
  type: "series" | "movie";
  name: string;
  poster?: string;
  background?: string;
  logo?: string;
  description?: string;
  releaseInfo?: string;
  imdbRating?: string;
  imdb_id?: string;
  videos: AnimeKitsuVideo[];
  links?: AnimeKitsuLink[];
};

type AddonMetaResponse = {
  meta?: {
    id?: string;
    type?: string;
    name?: string;
    poster?: string;
    background?: string;
    logo?: string;
    description?: string;
    releaseInfo?: string;
    imdbRating?: string;
    imdb_id?: string;
    videos?: AnimeKitsuVideo[];
    links?: AnimeKitsuLink[];
  };
};

export async function animeKitsuMeta(
  metaId: string,
  maxAge?: number,
): Promise<AnimeKitsuMeta | null> {
  if (
    !metaId.startsWith("kitsu:") &&
    !metaId.startsWith("mal:") &&
    !metaId.startsWith("anilist:") &&
    !metaId.startsWith("anidb:")
  ) {
    return null;
  }
  const key = metaId;
  const now = Date.now();
  const hit = lruGet(cache, key);
  // A miss is remembered too, on a shorter clock. This is the anime page's
  // steady-state hydration path: award and rail metas ship with no art on
  // purpose, so a title this addon does not carry was re-asked twice per tile
  // mount, for the life of the session, with nothing ever written down.
  if (
    hit &&
    hit.freshUntil > now &&
    now - hit.loadedAt < TTL &&
    (maxAge === undefined || now - hit.t < maxAge)
  )
    return hit.v;
  const existing = inflight.get(key);
  if (existing) return existing;
  const generation = mediaCacheGeneration();
  let definitiveAbsence = false;
  const p = loadMedia<AnimeKitsuMeta>(
    "anime-addon-meta",
    [HOST, metaId],
    async () => {
      try {
        const seriesUrl = `${HOST}/meta/series/${encodeURIComponent(metaId)}.json`;
        const movieUrl = `${HOST}/meta/movie/${encodeURIComponent(metaId)}.json`;
        const r = await safeFetch(seriesUrl);
        let raw: AddonMetaResponse | null = null;
        if (r.ok) raw = (await r.json()) as AddonMetaResponse;
        if (!raw?.meta || !raw.meta.id) {
          const r2 = await safeFetch(movieUrl);
          if (r2.ok) raw = (await r2.json()) as AddonMetaResponse;
          const absent = (response: Response) =>
            response.ok || response.status === 404 || response.status === 410;
          definitiveAbsence = absent(r) && absent(r2) && !raw?.meta?.id;
        }
        const m = raw?.meta;
        if (!m?.id) {
          return null;
        }
        const out: AnimeKitsuMeta = {
          id: m.id,
          type: m.type === "movie" ? "movie" : "series",
          name: m.name ?? "",
          poster: m.poster,
          background: m.background,
          logo: m.logo,
          description: m.description,
          releaseInfo: m.releaseInfo,
          imdbRating: m.imdbRating,
          imdb_id: m.imdb_id,
          videos: m.videos ?? [],
          links: m.links ?? [],
        };
        return out;
      } catch {
        return null;
      }
    },
    { ttl: (meta) => episodeCacheTtl(meta.videos), maxAge },
  )
    .then(({ value, storedAt }) => {
      if (generation === mediaCacheGeneration()) {
        if (value) {
          const t = storedAt ?? Date.now();
          const freshUntil = t + Math.min(TTL, episodeCacheTtl(value.videos, t));
          rememberSource(key, value, freshUntil);
          lruSet(cache, key, { v: value, t, freshUntil, loadedAt: Date.now() }, CACHE_MAX);
        } else if (definitiveAbsence) {
          const t = Date.now();
          const freshUntil = t + NEG_TTL;
          rememberSource(key, null, freshUntil);
          lruSet(cache, key, { v: null, t, freshUntil, loadedAt: Date.now() }, CACHE_MAX);
        }
      }
      return value;
    })
    .finally(() => {
      if (inflight.get(key) === p) inflight.delete(key);
    });
  inflight.set(key, p);
  return p;
}

export function animeKitsuMetaVersion(metaId: string): number | undefined {
  return sourceIdentities.get(metaId)?.revision;
}

export function animeKitsuMetaFreshUntil(metaId: string): number | undefined {
  return sourceIdentities.get(metaId)?.freshUntil;
}
