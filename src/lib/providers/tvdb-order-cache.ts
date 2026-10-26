import type { Season } from "@/lib/providers/tmdb";
import type { OrderedEpisode, TvdbOrder } from "./tvdb-order";
import { isPlaceholderEpisodeText } from "./episode-placeholder";
import {
  loadMedia,
  readMedia,
  saveMedia,
  mediaCacheGeneration,
  onMediaCacheClear,
  episodeCacheTtl,
  MEDIA_TTL,
} from "@/lib/media-cache";

// Preserve existing entries; older language evidence is normalized on read.
const PREFIX = "harbor.tvdbo.v8.";
const TTL = 3 * 24 * 60 * 60 * 1000;
onMediaCacheClear(() => {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith("harbor.tvdbo.")) keys.push(key);
    }
    for (const key of keys) localStorage.removeItem(key);
  } catch {
    /* Storage may be unavailable. */
  }
});

/**
 * A cached order is stale when it still carries a provider placeholder (e.g.
 * "TBA") for an episode that has already aired — providers publish the real
 * name on or shortly after the air date, so such a cache predates the name and
 * must not pin the placeholder on the page.
 */
export function isStaleTvdbOrder(
  bySeason: Iterable<[number, OrderedEpisode[]]>,
  now = Date.now(),
): boolean {
  for (const [, episodes] of bySeason) {
    for (const ep of episodes) {
      if (!isPlaceholderEpisodeText(ep.name)) continue;
      const aired = ep.airDate ? Date.parse(ep.airDate) : NaN;
      if (Number.isFinite(aired) && aired <= now) return true;
    }
  }
  return false;
}

type Serialized = {
  t: number;
  textEvidenceVersion?: number;
  seasons: Season[];
  seasonNamesResolved?: boolean;
  bySeason: [number, OrderedEpisode[]][];
  absByEpId: [number, number][];
  imageByAbs: [number, string][];
  textComplete?: boolean;
};

function serialize(order: TvdbOrder, t = Date.now()): Serialized {
  return {
    t,
    textEvidenceVersion: 1,
    seasons: order.seasons,
    seasonNamesResolved: order.seasonNamesResolved,
    bySeason: [...order.bySeason],
    absByEpId: [...order.absByEpId],
    imageByAbs: [...order.imageByAbs],
    textComplete: order.textComplete,
  };
}

function deserialize(s: Serialized): TvdbOrder {
  return {
    seasons: s.seasons,
    seasonNamesResolved: s.seasonNamesResolved,
    textComplete: s.textComplete,
    bySeason: new Map(s.bySeason),
    absByEpId: new Map(s.absByEpId),
    imageByAbs: new Map(
      s.imageByAbs.filter(([absolute]) => Number.isInteger(absolute) && absolute > 0),
    ),
  };
}

const policy = {
  ttl: (s: Serialized) =>
    s.textComplete === false
      ? MEDIA_TTL.recent
      : episodeCacheTtl(s.bySeason.flatMap(([, rows]) => rows)),
  staleWhileRevalidate: true,
  valid: (s: Serialized) =>
    !!s &&
    Array.isArray(s.seasons) &&
    s.seasons.every((season) => Number.isInteger(season?.seasonNumber)) &&
    Array.isArray(s.bySeason) &&
    s.bySeason.every(
      (pair) =>
        Array.isArray(pair) &&
        Number.isInteger(pair[0]) &&
        Array.isArray(pair[1]) &&
        pair[1].every((ep) => ep && Number.isFinite(ep.id) && Number.isInteger(ep.episodeNumber)),
    ) &&
    Array.isArray(s.absByEpId) &&
    s.absByEpId.every(
      (pair) => Array.isArray(pair) && Number.isFinite(pair[0]) && Number.isFinite(pair[1]),
    ) &&
    Array.isArray(s.imageByAbs) &&
    s.imageByAbs.every(
      (pair) => Array.isArray(pair) && Number.isFinite(pair[0]) && typeof pair[1] === "string",
    ),
};

export async function loadOrderCache(
  apiKey: string,
  seriesId: number,
  type: string,
  loader: () => Promise<TvdbOrder | null>,
  allowProxyNames = false,
): Promise<{ value: TvdbOrder | null; storedAt?: number; refresh?: Promise<TvdbOrder | null> }> {
  const scope = [apiKey, seriesId, type, apiKey.trim() ? true : allowProxyNames];
  const generation = mediaCacheGeneration();
  if (!(await readMedia("tvdb-order", scope))) {
    const legacy = readOrderCache(seriesId, type);
    if (legacy) {
      const keys = [
        `${PREFIX}${seriesId}:${type}`,
        `${PREFIX}${seriesId}:${type.replace(/^(?:direct|proxy):/, "")}`,
      ];
      const raw = keys.map((key) => localStorage.getItem(key)).find(Boolean);
      const storedAt = raw ? (JSON.parse(raw) as Serialized).t : Date.now();
      if (
        await saveMedia(
          "tvdb-order",
          scope,
          serialize(legacy, storedAt),
          { ...policy, ttl: 0 },
          storedAt,
          generation,
        )
      ) {
        for (const key of keys) localStorage.removeItem(key);
      }
    }
  }
  if (generation !== mediaCacheGeneration()) return { value: null };
  const result = await loadMedia(
    "tvdb-order",
    scope,
    async () => {
      const order = await loader();
      return order ? serialize(order) : null;
    },
    policy,
  );
  return {
    value: result.value ? deserialize(result.value) : null,
    storedAt: result.storedAt,
    refresh: result.refresh?.then((value) => (value ? deserialize(value) : null)),
  };
}

export async function persistOrderCache(
  apiKey: string,
  seriesId: number,
  type: string,
  order: TvdbOrder,
  storedAt: number,
  generation: number,
  allowProxyNames = false,
) {
  return saveMedia(
    "tvdb-order",
    [apiKey, seriesId, type, apiKey.trim() ? true : allowProxyNames],
    serialize(order, storedAt),
    policy,
    storedAt,
    generation,
  );
}

export function readOrderCache(seriesId: number, seasonType: string): TvdbOrder | null {
  try {
    const key = `${PREFIX}${seriesId}:${seasonType}`;
    const legacyKey = `${PREFIX}${seriesId}:${seasonType.replace(/^(?:direct|proxy):/, "")}`;
    const raw = localStorage.getItem(key) ?? localStorage.getItem(legacyKey);
    if (!raw) return null;
    const s = JSON.parse(raw) as Serialized;
    if (!policy.valid(s) || !Number.isFinite(s.t) || Date.now() - s.t > TTL || s.t > Date.now())
      return null;
    if (isStaleTvdbOrder(s.bySeason)) return null;
    if (s.textEvidenceVersion !== 1) {
      for (const [, episodes] of s.bySeason) {
        for (const ep of episodes) {
          ep.nameLanguage = "und";
          ep.overviewLanguage = "und";
          ep.nameEnLanguage = "und";
          ep.overviewEnLanguage = "und";
        }
      }
    }
    return {
      seasons: s.seasons,
      seasonNamesResolved: s.seasonNamesResolved,
      bySeason: new Map(s.bySeason),
      absByEpId: new Map(s.absByEpId),
      imageByAbs: new Map(
        s.imageByAbs.filter(([absolute]) => Number.isInteger(absolute) && absolute > 0),
      ),
    };
  } catch {
    return null;
  }
}
