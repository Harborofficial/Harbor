import {
  getAnimeCanonicalId,
  getAnimeCwId,
  getAnilistMalAlias,
  recordAnimeCwId,
  notifyAnimeCwIds,
} from "@/lib/anime-cw-ids";
import {
  animeDbReadEntry,
  animeDbReadProvider,
  animeDbWriteProvider,
} from "@/lib/anime-identity-db";
import { resolveAnimeEntry } from "@/lib/providers/anime-entry";
import { animeKitsuMeta, type AnimeKitsuMeta } from "@/lib/providers/anime-kitsu-addon";
import { resolveTrackerAnimeEntry } from "@/lib/anime-tracker-entry";

const KITSU_ID = /^kitsu:[1-9]\d*$/;
const KITSU_STREAM = /^kitsu:([1-9]\d*):[1-9]\d*$/;
const nativeEntry = /^(kitsu|mal|anilist|anidb):[1-9]\d*$/;
const catalogEntry = /^(?:tt\d+|tmdb:tv:[1-9]\d*)$/;
const CACHE_MAX = 512;
const POSITIVE_TTL = 24 * 60 * 60 * 1000;
const NEGATIVE_TTL = 60 * 1000;
const NATIVE_DB_TTL = 30 * 24 * 60 * 60 * 1000;
const MAX_CONCURRENT = 4;

export type CwAnimeCoords = { season?: number; episode?: number; imdbId?: string | null };
type CwIdentityItem = {
  _id?: string;
  id?: string;
  videoId?: string | null;
  name?: string;
  type?: string;
  isAnime?: boolean;
  local?: boolean;
  altIds?: string[];
  source?: string;
  sourceId?: string;
  externalId?: string;
  external?: string;
  state?: {
    video_id?: string | null;
    season?: number;
    episode?: number;
    time?: number;
    timeOffset?: number;
    duration?: number;
    lastWatched?: string | number;
    imdb_id?: string | null;
  };
  imdb_id?: string | null;
  season?: number;
  episode?: number;
  timeOffset?: number;
  duration?: number;
  lastWatched?: string | number;
  cwMembers?: CwIdentityItem[];
};

const resolvedCatalogImdb = new Map<string, string>();

function proofKey(id: string, videoId: string | null | undefined, coords: CwAnimeCoords): string {
  const imdbId = /^tt\d+$/.test(id) ? id : (coords.imdbId ?? "");
  return `cw-anime-proof:v1:${encodeURIComponent(id)}:${encodeURIComponent(videoId ?? "")}:${coords.season ?? ""}:${coords.episode ?? ""}:${encodeURIComponent(imdbId)}`;
}

function sourceImdbFor(item: CwIdentityItem, id: string): string | null {
  if (/^tt\d+$/.test(id)) return id;
  const alt = item.altIds?.find((value) => /^tt\d+$/.test(value));
  return item.imdb_id ?? item.state?.imdb_id ?? alt ?? resolvedCatalogImdb.get(id) ?? null;
}

function checkpointCoords(
  item: CwIdentityItem,
  id: string,
  videoId: string | null | undefined,
): CwAnimeCoords {
  let season = item.season ?? item.state?.season;
  let episode = item.episode ?? item.state?.episode;
  if (
    (!Number.isInteger(season) || !Number.isInteger(episode)) &&
    catalogEntry.test(id) &&
    videoId
  ) {
    const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = new RegExp(`^${escaped}:([1-9]\\d*):([1-9]\\d*)$`).exec(videoId);
    if (match) {
      season = Number(match[1]);
      episode = Number(match[2]);
    }
  }
  return { season, episode, imdbId: sourceImdbFor(item, id) };
}

/** IMDb id discovered during background proof, so later synchronous passes can reuse it. */
export function getCachedCatalogImdb(id: string): string | null {
  return resolvedCatalogImdb.get(id) ?? null;
}

const catalogProofs = new Map<string, { identity: string | null; expiresAt: number }>();
const warmInflight = new Map<string, Promise<void>>();
const warmCache = new Map<string, { identity: string | null; expiresAt: number }>();
const nativeInflight = new Map<string, Promise<string | null>>();
const nativeCache = new Map<string, { identity: string | null; expiresAt: number }>();
let activeJobs = 0;
const waiters: Array<() => void> = [];

async function limited<T>(run: () => Promise<T>): Promise<T> {
  if (activeJobs >= MAX_CONCURRENT) await new Promise<void>((resolve) => waiters.push(resolve));
  else activeJobs++;
  try {
    return await run();
  } finally {
    const next = waiters.shift();
    if (next) next();
    else activeJobs--;
  }
}

function boundedSet<K, V>(map: Map<K, V>, key: K, value: V, max = CACHE_MAX): void {
  if (map.has(key)) map.delete(key);
  else if (map.size >= max) map.delete(map.keys().next().value as K);
  map.set(key, value);
}

/** Offline CW identity. Catalog checkpoints require exact snapshot proof. */
export function cwAnimeIdentityKey(
  id: string,
  videoId?: string | null,
  coordinates?: CwAnimeCoords,
): string | null {
  // A saved Kitsu stream names the played cour even if the card ID has advanced.
  const stream = KITSU_STREAM.exec(videoId ?? "");
  if (stream) return `kitsu:${stream[1]}`;
  if (KITSU_ID.test(id)) return id;
  if (nativeEntry.test(id)) {
    const played = getAnimeCwId(id);
    const canonical = getAnimeCanonicalId(id);
    for (const candidate of [played, canonical])
      if (candidate && KITSU_ID.test(candidate)) return candidate;
    if (id.startsWith("mal:") || id.startsWith("anidb:") || id.startsWith("kitsu:")) return id;
    const alias = getAnilistMalAlias(id);
    if (!alias) return null;
    const resolved = getAnimeCwId(alias) ?? getAnimeCanonicalId(alias);
    return resolved && KITSU_ID.test(resolved) ? resolved : alias;
  }
  const checkpoint =
    coordinates ?? (catalogEntry.test(id) ? checkpointCoords({}, id, videoId) : undefined);
  if (checkpoint?.season == null || checkpoint.episode == null) return null;
  if (
    !Number.isInteger(checkpoint.season) ||
    checkpoint.season < 1 ||
    !Number.isInteger(checkpoint.episode) ||
    checkpoint.episode < 1
  )
    return null;
  const key = proofKey(id, videoId, checkpoint);
  const proof = catalogProofs.get(key);
  if (proof && proof.expiresAt > Date.now()) return proof.identity;
  if (proof) catalogProofs.delete(key);
  return null;
}

async function resolveNative(id: string): Promise<string | null> {
  const cached = nativeCache.get(id);
  if (cached && cached.expiresAt > Date.now()) return cached.identity;
  const existing = nativeInflight.get(id);
  if (existing) return existing;
  const task = limited(async () => {
    const row = await animeDbReadEntry(id);
    const age = row ? Date.now() - row.updatedAt : Infinity;
    const storedId = row && age >= 0 && age <= NATIVE_DB_TTL ? row.ids.kitsu : null;
    if (typeof storedId === "number" && Number.isSafeInteger(storedId) && storedId > 0)
      return `kitsu:${storedId}`;
    const entry = await resolveAnimeEntry(id).catch(() => null);
    return entry && Number.isSafeInteger(entry.kitsuId) && entry.kitsuId > 0
      ? `kitsu:${entry.kitsuId}`
      : null;
  })
    .then((identity) => {
      boundedSet(nativeCache, id, {
        identity,
        expiresAt: Date.now() + (identity ? POSITIVE_TTL : NEGATIVE_TTL),
      });
      if (identity) {
        recordAnimeCwId(id, identity);
      }
      return identity;
    })
    .finally(() => nativeInflight.delete(id));
  nativeInflight.set(id, task);
  return task;
}

async function resolveCatalog(
  id: string,
  item: CwIdentityItem,
  coords: CwAnimeCoords,
): Promise<string | null> {
  const sourceImdb = sourceImdbFor(item, id);
  if (
    !sourceImdb ||
    !Number.isInteger(coords.season) ||
    coords.season! < 1 ||
    !Number.isInteger(coords.episode) ||
    coords.episode! < 1
  )
    return null;
  const candidate = await resolveTrackerAnimeEntry(id, {
    season: coords.season,
    episode: coords.episode,
  }).catch(() => null);
  if (!candidate) return null;
  const meta: AnimeKitsuMeta | null = await animeKitsuMeta(candidate.id).catch(() => null);
  if (!meta || meta.id !== candidate.id) return null;
  const exact = (meta.videos ?? []).filter(
    (video) =>
      video.imdb_id === sourceImdb &&
      video.imdbSeason === coords.season &&
      video.imdbEpisode === coords.episode,
  );
  if (exact.length === 0) return null;
  const entryIds = new Set(
    exact.map((video) => /^kitsu:([1-9]\d*):[1-9]\d*$/.exec(video.id)?.[1]).filter(Boolean),
  );
  if (entryIds.size > 1) return null;
  const metaKitsuId = /^kitsu:([1-9]\d*)$/.exec(meta.id)?.[1];
  const candidateKitsuId = /^kitsu:([1-9]\d*)$/.exec(candidate.id)?.[1];
  const provenId = metaKitsuId ?? candidateKitsuId;
  if (provenId && entryIds.size === 1 && !entryIds.has(provenId)) return null;
  return provenId ? `kitsu:${provenId}` : null;
}

const imdbInflight = new Map<string, Promise<string | null>>();

async function resolveTmdbImdb(id: string, tmdbKey: string): Promise<string | null> {
  const match = /^tmdb:tv:([1-9]\d*)$/.exec(id);
  if (!match) return null;
  const { tmdbImdbCached, tmdbImdbId } = await import("@/lib/providers/tmdb/tmdb-imdb-resolve");
  const cached = tmdbImdbCached(id);
  if (cached) return cached;
  if (tmdbKey) {
    const viaTmdb = await tmdbImdbId(tmdbKey, id).catch(() => null);
    if (viaTmdb) return viaTmdb;
  }
  const { getImdbForTmdb } = await import("@/lib/publicmetadb/mappings");
  return (await getImdbForTmdb(Number(match[1]), "tv").catch(() => null)) ?? null;
}

function ensureCatalogImdb(id: string, tmdbKey: string): Promise<string | null> {
  if (!/^tmdb:tv:[1-9]\d*$/.test(id)) return Promise.resolve(null);
  const known = resolvedCatalogImdb.get(id);
  if (known) return Promise.resolve(known);
  const existing = imdbInflight.get(id);
  if (existing) return existing;
  const task = limited(() => resolveTmdbImdb(id, tmdbKey))
    .then((imdb) => {
      if (imdb) boundedSet(resolvedCatalogImdb, id, imdb);
      return imdb;
    })
    .catch(() => null)
    .finally(() => imdbInflight.delete(id));
  imdbInflight.set(id, task);
  return task;
}

async function warmOne(item: CwIdentityItem, tmdbKey = ""): Promise<void> {
  const id = item._id ?? item.id ?? "";
  if (!id || KITSU_ID.test(id)) return;
  const videoId = item.videoId ?? item.state?.video_id;
  const isNative = nativeEntry.test(id);
  if (!isNative && !catalogEntry.test(id)) return;
  const coords: CwAnimeCoords = isNative ? {} : checkpointCoords(item, id, videoId);
  if (
    !isNative &&
    (!Number.isInteger(coords.season) ||
      coords.season! < 1 ||
      !Number.isInteger(coords.episode) ||
      coords.episode! < 1)
  )
    return;
  if (!isNative && !coords.imdbId) {
    const derived = await ensureCatalogImdb(id, tmdbKey).catch(() => null);
    if (derived) coords.imdbId = derived;
  }
  if (!isNative && !coords.imdbId) return;
  const snapshotKey = isNative ? `native:${id}` : proofKey(id, videoId, coords);
  const now = Date.now();
  const cached = warmCache.get(snapshotKey);
  if (cached && cached.expiresAt > now) {
    if (cached.identity && !isNative)
      boundedSet(catalogProofs, proofKey(id, videoId, coords), {
        identity: cached.identity,
        expiresAt: cached.expiresAt,
      });
    return;
  }
  const inflightKey = snapshotKey;
  const existing = warmInflight.get(inflightKey);
  if (existing) return existing;

  const task = (async () => {
    try {
      if (!isNative) {
        const stored = await animeDbReadProvider<{
          source: string;
          id: string;
          videoId: string | null;
          season?: number;
          episode?: number;
          imdbId?: string | null;
          candidateId?: string;
          identity: string | null;
        }>(snapshotKey);
        if (
          stored &&
          stored.expiresAt > Date.now() &&
          stored.value?.source === "exact-kitsu-addon-video" &&
          typeof stored.value.identity === "string" &&
          KITSU_ID.test(stored.value.identity) &&
          stored.value.id === id &&
          stored.value.videoId === (videoId ?? null) &&
          stored.value.season === coords.season &&
          stored.value.episode === coords.episode &&
          stored.value.imdbId === (coords.imdbId ?? null) &&
          stored.value.candidateId === stored.value.identity
        ) {
          boundedSet(warmCache, snapshotKey, {
            identity: stored.value.identity,
            expiresAt: stored.expiresAt,
          });
          if (stored.value.identity) {
            boundedSet(catalogProofs, proofKey(id, videoId, coords), {
              identity: stored.value.identity,
              expiresAt: stored.expiresAt,
            });
            notifyAnimeCwIds();
          }
          return;
        }
      }
      const identity = await (isNative
        ? resolveNative(id)
        : limited(() => resolveCatalog(id, item, coords)));
      const expiresAt = Date.now() + (identity ? POSITIVE_TTL : NEGATIVE_TTL);
      boundedSet(warmCache, snapshotKey, { identity, expiresAt });
      if (identity && !isNative) {
        boundedSet(catalogProofs, proofKey(id, videoId, coords), { identity, expiresAt });
        await animeDbWriteProvider({
          key: snapshotKey,
          value: {
            source: "exact-kitsu-addon-video",
            id,
            videoId: videoId ?? null,
            candidateId: identity,
            season: coords.season,
            episode: coords.episode,
            imdbId: coords.imdbId ?? null,
            identity,
          },
          expiresAt,
          fetchedAt: Date.now(),
        });
      }
      if (identity) notifyAnimeCwIds();
    } catch {
      boundedSet(warmCache, snapshotKey, { identity: null, expiresAt: Date.now() + NEGATIVE_TTL });
    } finally {
      warmInflight.delete(inflightKey);
    }
  })();
  warmInflight.set(inflightKey, task);
  return task;
}

const MOVIE_ID = /^(?:tt\d+|tmdb:movie:[1-9]\d*)$/;

function movieIds(item: CwIdentityItem): string[] {
  const id = item._id ?? item.id ?? "";
  if (item.type !== "movie" || item.isAnime || !MOVIE_ID.test(id)) return [];
  const cached = warmCache.get(`movie:${id}`);
  const mapped = cached && cached.expiresAt > Date.now() ? cached.identity : null;
  return [
    ...new Set(
      [id, ...(item.altIds ?? []), ...(mapped ? [mapped] : [])].filter((value) =>
        MOVIE_ID.test(value),
      ),
    ),
  ];
}

async function warmMovie(item: CwIdentityItem, tmdbKey: string): Promise<void> {
  const id = item._id ?? item.id ?? "";
  const aliases = movieIds(item);
  if (aliases.length === 0) return;
  if (
    aliases.some((alias) => alias.startsWith("tt")) &&
    aliases.some((alias) => alias.startsWith("tmdb:movie:"))
  )
    return;
  const key = `movie:${id}`;
  const cached = warmCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return;
  const existing = warmInflight.get(key);
  if (existing) return existing;
  const task = limited(async () => {
    const { tmdbImdbCached, tmdbFromImdbCached, tmdbImdbId } =
      await import("@/lib/providers/tmdb/tmdb-imdb-resolve");
    if (id.startsWith("tt")) {
      const tmdbId = tmdbFromImdbCached(id);
      return tmdbId && /^tmdb:movie:[1-9]\d*$/.test(tmdbId) ? tmdbId : null;
    }
    let imdb = tmdbImdbCached(id);
    if (!imdb && tmdbKey) imdb = await tmdbImdbId(tmdbKey, id).catch(() => null);
    if (!imdb) {
      const { getImdbForTmdb } = await import("@/lib/publicmetadb/mappings");
      imdb = await getImdbForTmdb(Number(id.slice("tmdb:movie:".length)), "movie").catch(
        () => null,
      );
    }
    return imdb && /^tt\d+$/.test(imdb) ? imdb : null;
  })
    .then((identity) => {
      boundedSet(warmCache, key, {
        identity,
        expiresAt: Date.now() + (identity ? POSITIVE_TTL : NEGATIVE_TTL),
      });
      if (identity) notifyAnimeCwIds();
    })
    .catch(() => {
      boundedSet(warmCache, key, { identity: null, expiresAt: Date.now() + NEGATIVE_TTL });
    })
    .finally(() => warmInflight.delete(key));
  warmInflight.set(key, task);
  return task;
}

/** Resolve checkpoint snapshots with bounded concurrency shared across all callers. */
export async function warmCwAnimeIdentities(
  items: CwIdentityItem[],
  options: { tmdbKey?: string } = {},
): Promise<void> {
  const snapshots: CwIdentityItem[] = [];
  const visited = new Set<CwIdentityItem>();
  const flatten = (item: CwIdentityItem) => {
    if (visited.has(item)) return;
    visited.add(item);
    snapshots.push(item);
    item.cwMembers?.forEach(flatten);
  };
  items.forEach(flatten);
  await Promise.all(
    snapshots.map((item) =>
      (movieIds(item).length > 0
        ? warmMovie(item, options.tmdbKey ?? "")
        : warmOne(item, options.tmdbKey ?? "")
      ).catch(() => undefined),
    ),
  );
}

function memberKey(item: CwIdentityItem): string {
  const state = item.state;
  return [
    item.source,
    item.external,
    item.local,
    item.sourceId,
    item.externalId,
    item._id ?? item.id,
    item.videoId ?? state?.video_id,
    item.season ?? state?.season,
    item.episode ?? state?.episode,
    item.timeOffset ?? state?.timeOffset ?? state?.time,
    item.duration ?? state?.duration,
    item.lastWatched ?? state?.lastWatched,
  ]
    .map((value) => String(value ?? ""))
    .join("|");
}

/** Items are freshness-sorted; retain every original source checkpoint. */
export function dedupeAnimeCw<T extends CwIdentityItem>(items: T[]): T[] {
  // Build movie alias components before picking survivors: a later provider
  // row can connect an earlier IMDb row to an earlier TMDB row.
  const parents = new Map<string, string>();
  const root = (id: string): string => {
    if (!parents.has(id)) parents.set(id, id);
    let current = id;
    while (parents.get(current) !== current) current = parents.get(current)!;
    while (parents.get(id) !== id) {
      const next = parents.get(id)!;
      parents.set(id, current);
      id = next;
    }
    return current;
  };
  for (const item of items.flatMap((entry) => [entry, ...(entry.cwMembers ?? [])])) {
    const ids = movieIds(item);
    for (const id of ids.slice(1)) parents.set(root(id), root(ids[0]));
  }
  const imdbIds = new Map<string, Set<string>>();
  for (const id of parents.keys()) {
    if (!id.startsWith("tt")) continue;
    const key = root(id);
    const ids = imdbIds.get(key) ?? new Set<string>();
    ids.add(id);
    imdbIds.set(key, ids);
  }
  const output: T[] = [];
  const indexes = new Map<string, number>();
  for (const item of items) {
    const sourceId = item._id ?? item.id ?? "";
    const videoId = item.videoId ?? item.state?.video_id;
    const kind = item.type === "movie" ? "movie" : "series";
    const movieGroup = movieIds(item).length > 0 ? root(sourceId) : null;
    const movieIdentity =
      movieGroup && (imdbIds.get(movieGroup)?.size ?? 0) <= 1 ? `movie:${movieGroup}` : null;
    const animeIdentity = cwAnimeIdentityKey(
      sourceId,
      videoId,
      checkpointCoords(item, sourceId, videoId),
    );
    const identity =
      movieIdentity ??
      (animeIdentity ? `${kind}:${animeIdentity}` : sourceId ? `source:${kind}:${sourceId}` : null);
    if (!identity) {
      output.push(item);
      continue;
    }
    const index = indexes.get(identity);
    if (index == null) {
      indexes.set(identity, output.length);
      output.push(item);
      continue;
    }
    const existing = output[index];
    const members = [...(existing.cwMembers ?? [existing]), ...(item.cwMembers ?? [item])];
    const unique = [...new Map(members.map((member) => [memberKey(member), member])).values()];
    output[index] = { ...existing, cwMembers: unique } as T;
  }
  return output;
}
