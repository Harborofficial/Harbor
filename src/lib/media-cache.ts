import { mediaCacheStore, type MediaCacheRecord, type MediaCacheStore } from "./media-cache-store";

export const MEDIA_CACHE_DISK_BYTES = 512 * 1024 * 1024;
const MEMORY_BYTES = 16 * 1024 * 1024;
export const MEDIA_TTL = {
  recent: 60 * 60_000,
  episodes: 12 * 60 * 60_000,
  settled: 7 * 24 * 60 * 60_000,
  stale: 30 * 24 * 60 * 60_000,
};

export type MediaCachePolicy<T> = {
  ttl?: number | ((value: T) => number);
  maxAge?: number;
  stale?: number;
  staleWhileRevalidate?: boolean;
  fallbackOnError?: boolean;
  valid?: (value: T) => boolean;
};

export type MediaCacheResult<T> = {
  value: T | null;
  storedAt?: number;
  refresh?: Promise<T | null>;
};

function copy<T>(value: T): T {
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : (JSON.parse(JSON.stringify(value)) as T);
}

function validRecord(record: MediaCacheRecord | null, key: string): record is MediaCacheRecord {
  return (
    !!record &&
    record.key === key &&
    Number.isFinite(record.storedAt) &&
    Number.isFinite(record.freshUntil) &&
    Number.isFinite(record.staleUntil) &&
    Number.isFinite(record.bytes) &&
    record.bytes >= 0 &&
    record.freshUntil >= record.storedAt &&
    record.staleUntil >= record.freshUntil &&
    record.value != null
  );
}

function traceCache(key: string, result: string): void {
  if (typeof window !== "undefined") {
    window.__harborProfiler?.mark("metadata-cache", {
      namespace: key.split(":")[1] ?? "metadata",
      result,
    });
  }
}

export function createMediaCache(
  store: MediaCacheStore,
  options: { now?: () => number; memoryBytes?: number; diskBytes?: number } = {},
) {
  const now = options.now ?? Date.now;
  const memoryLimit = options.memoryBytes ?? MEMORY_BYTES;
  const diskLimit = options.diskBytes ?? MEDIA_CACHE_DISK_BYTES;
  const memory = new Map<string, MediaCacheRecord>();
  const inFlight = new Map<string, Promise<MediaCacheResult<unknown>>>();
  const pendingWrites = new Map<string, MediaCacheRecord>();
  const retryAt = new Map<string, number>();
  let memoryBytes = 0;
  let generation = 0;
  let writes: Promise<unknown> = Promise.resolve();
  let clearing: Promise<boolean> = Promise.resolve(true);
  let prune: Promise<void> | undefined;
  const counters = {
    hits: 0,
    diskHits: 0,
    staleHits: 0,
    misses: 0,
    shared: 0,
    errors: 0,
    writes: 0,
  };

  function remember(record: MediaCacheRecord) {
    const previous = memory.get(record.key);
    if (previous) memoryBytes -= previous.bytes;
    memory.delete(record.key);
    if (record.bytes <= memoryLimit) {
      memory.set(record.key, record);
      memoryBytes += record.bytes;
    }
    while (memoryBytes > memoryLimit) {
      const first = memory.entries().next().value;
      if (!first) break;
      memory.delete(first[0]);
      memoryBytes -= first[1].bytes;
    }
  }

  function enqueue<T>(work: () => Promise<T>): Promise<T> {
    const job = writes.then(work, work);
    writes = job.catch(() => {});
    return job;
  }

  let diskBytes = 0;
  let diskEntriesKnown = false;
  let writesSincePrune = 0;
  const diskSizes = new Map<string, number>();

  async function ensureDiskTotals() {
    if (diskEntriesKnown) return;
    const index = await store.list();
    diskSizes.clear();
    diskBytes = 0;
    for (const entry of index) {
      diskSizes.set(entry.key, entry.bytes);
      diskBytes += entry.bytes;
    }
    diskEntriesKnown = true;
  }

  async function pruneDisk(force = false) {
    if (prune) return prune;
    const scope = generation;
    prune = (async () => {
      // Expired keys are fetched by index; the full index scan only runs when
      // the byte budget is actually exceeded or a write needs room.
      await ensureDiskTotals();
      if (scope !== generation) return;
      if (store.removeExpired) {
        const expired = await store.removeExpired(now()).catch(() => []);
        for (const key of expired) {
          diskBytes -= diskSizes.get(key) ?? 0;
          diskSizes.delete(key);
        }
      }
      if (scope !== generation) return;
      if (!force && diskBytes <= diskLimit) return;
      const index = await store.list();
      if (scope !== generation) return;
      diskSizes.clear();
      diskBytes = 0;
      for (const entry of index) {
        diskSizes.set(entry.key, entry.bytes);
        diskBytes += entry.bytes;
      }
      let bytes = diskBytes;
      const target = force ? diskLimit * 0.8 : diskLimit;
      const remove: string[] = [];
      index.sort((a, b) => a.accessedAt - b.accessedAt);
      for (const entry of index) {
        if (entry.staleUntil <= now() || bytes > target || (force && remove.length === 0)) {
          remove.push(entry.key);
          bytes -= entry.bytes;
        }
      }
      if (scope === generation) {
        await store.remove(remove);
        for (const key of remove) {
          diskBytes -= diskSizes.get(key) ?? 0;
          diskSizes.delete(key);
        }
      }
    })()
      .catch(() => {
        counters.errors++;
      })
      .finally(() => {
        prune = undefined;
      });
    return prune;
  }

  async function save<T>(key: string, value: T, policy: MediaCachePolicy<T>, storedAt = now()) {
    const scope = generation;
    let bytes: number;
    try {
      bytes = new TextEncoder().encode(JSON.stringify(value)).byteLength;
    } catch {
      return false;
    }
    if (bytes > diskLimit || value == null || policy.valid?.(value) === false) return false;
    const ttl =
      typeof policy.ttl === "function" ? policy.ttl(value) : (policy.ttl ?? MEDIA_TTL.episodes);
    const record: MediaCacheRecord<T> = {
      key,
      value: copy(value),
      storedAt,
      bytes,
      freshUntil: storedAt + ttl,
      staleUntil: storedAt + Math.max(ttl, policy.stale ?? MEDIA_TTL.stale),
      accessedAt: now(),
    };
    remember(record);
    pendingWrites.set(key, record);
    return enqueue(async () => {
      if (scope !== generation) return false;
      await ensureDiskTotals().catch(() => {});
      let previous = diskSizes.get(key) ?? 0;
      let saved = await store.put(record).catch(() => false);
      if (!saved && scope === generation) {
        await pruneDisk(true);
        previous = diskSizes.get(key) ?? 0;
        if (scope === generation) saved = await store.put(record).catch(() => false);
      }
      if (saved) {
        counters.writes++;
        diskSizes.set(key, bytes);
        diskBytes += bytes - previous;
        writesSincePrune++;
        if (diskBytes > diskLimit || writesSincePrune >= 32) {
          writesSincePrune = 0;
          await pruneDisk();
        }
      } else counters.errors++;
      return saved;
    }).finally(() => {
      if (pendingWrites.get(key) === record) pendingWrites.delete(key);
    });
  }

  async function load<T>(
    key: string,
    loader: () => Promise<T | null>,
    policy: MediaCachePolicy<T> = {},
  ): Promise<MediaCacheResult<T>> {
    const scope = generation;
    await clearing;
    if (scope !== generation) return { value: null };
    let record = memory.get(key) ?? pendingWrites.get(key) ?? null;
    if (!record) {
      record = await store.get(key).catch(() => null);
      if (scope !== generation) return { value: null };
      record = memory.get(key) ?? pendingWrites.get(key) ?? record;
      if (validRecord(record, key)) {
        counters.diskHits++;
        remember(record);
      }
    }
    if (
      !validRecord(record, key) ||
      record.staleUntil <= now() ||
      policy.valid?.(record.value as T) === false
    )
      record = null;
    if (
      record &&
      Math.min(record.freshUntil, record.storedAt + (policy.maxAge ?? Infinity)) > now()
    ) {
      counters.hits++;
      traceCache(key, "hit");
      if (now() - record.accessedAt > 60_000) {
        record.accessedAt = now();
        const accessedAt = record.accessedAt;
        void enqueue(async () => {
          if (scope === generation) await store.touch?.(key, accessedAt);
        });
      }
      remember(record);
      return { value: copy(record.value as T), storedAt: record.storedAt };
    }
    const stale = record;
    if ((retryAt.get(key) ?? 0) > now()) {
      return {
        value: policy.fallbackOnError !== false && stale ? copy(stale.value as T) : null,
        storedAt: stale?.storedAt,
      };
    }
    let running = inFlight.get(key) as Promise<MediaCacheResult<T>> | undefined;
    if (running) counters.shared++;
    else {
      counters.misses++;
      traceCache(key, stale ? "revalidate" : "miss");
      running = (async () => {
        let invalid = false;
        try {
          const value = await loader();
          if (value == null) throw new Error("Incomplete media metadata");
          if (policy.valid?.(value) === false) {
            // A shape/canonical-id mismatch is not a network failure; do not
            // let the retry backoff turn the next load into an empty result.
            invalid = true;
            throw new Error("Incomplete media metadata");
          }
          const storedAt = now();
          if (scope === generation) {
            retryAt.delete(key);
            void save(key, value, policy, storedAt).catch(() => {
              counters.errors++;
            });
          }
          return { value, storedAt };
        } catch {
          counters.errors++;
          if (!invalid && scope === generation) {
            retryAt.set(key, now() + 30_000);
            while (retryAt.size > 300) retryAt.delete(retryAt.keys().next().value!);
          }
          return {
            value:
              !policy.staleWhileRevalidate && policy.fallbackOnError !== false && stale
                ? copy(stale.value as T)
                : null,
            storedAt: stale?.storedAt,
          };
        }
      })().finally(() => {
        if (inFlight.get(key) === running) inFlight.delete(key);
      });
      inFlight.set(key, running);
    }
    if (stale && policy.staleWhileRevalidate) {
      counters.staleHits++;
      traceCache(key, "stale");
      return {
        value: copy(stale.value as T),
        storedAt: stale.storedAt,
        refresh: running.then(({ value }) => (value == null ? null : copy(value))),
      };
    }
    const { value, storedAt } = await running;
    return { value: value == null ? null : copy(value), storedAt };
  }

  return {
    load,
    save,
    generation: () => generation,
    flush: () => writes,
    async peek(key: string) {
      const scope = generation;
      await clearing;
      const record =
        memory.get(key) ?? pendingWrites.get(key) ?? (await store.get(key).catch(() => null));
      if (scope !== generation || !validRecord(record, key) || record.staleUntil <= now())
        return null;
      remember(record);
      const { value: _value, ...index } = record;
      return index;
    },
    async clear() {
      generation++;
      memory.clear();
      memoryBytes = 0;
      inFlight.clear();
      pendingWrites.clear();
      retryAt.clear();
      writesSincePrune = 0;
      clearing = enqueue(async () => {
        const ok = await store.clear();
        diskSizes.clear();
        diskBytes = 0;
        // A failed clear must reload the real totals on the next write.
        diskEntriesKnown = ok;
        return ok;
      });
      return clearing;
    },
    async stats() {
      await writes;
      const index = await store.list().catch(() => []);
      return {
        ...counters,
        entries: index.length,
        bytes: index.reduce((sum, entry) => sum + entry.bytes, 0),
        memoryBytes,
        limit: diskLimit,
      };
    },
  };
}

const cache = createMediaCache(mediaCacheStore);
// A best-effort request keeps the durable cache from being evicted as
// best-effort storage under disk pressure.
if (typeof navigator !== "undefined") {
  try {
    void navigator.storage?.persist?.().catch(() => {});
  } catch {
    /* Storage persistence is optional. */
  }
}
const invalidators = new Set<() => void>();
export const mediaCacheGeneration = () => cache.generation();
export function onMediaCacheClear(clear: () => void): void {
  invalidators.add(clear);
}

export async function mediaCacheKey(
  namespace: string,
  scope: readonly unknown[],
): Promise<string | null> {
  try {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(JSON.stringify(scope)),
    );
    return `v1:${namespace}:${Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("")}`;
  } catch {
    return null;
  }
}

export async function loadMedia<T>(
  namespace: string,
  scope: readonly unknown[],
  loader: () => Promise<T | null>,
  policy?: MediaCachePolicy<T>,
): Promise<MediaCacheResult<T>> {
  const generation = cache.generation();
  const key = await mediaCacheKey(namespace, scope);
  if (generation !== cache.generation()) return { value: null };
  if (!key) return { value: await loader().catch(() => null) };
  return cache.load(key, loader, policy);
}

export async function cachedMedia<T>(
  namespace: string,
  scope: readonly unknown[],
  loader: () => Promise<T | null>,
  policy?: MediaCachePolicy<T>,
): Promise<T | null> {
  return (await loadMedia(namespace, scope, loader, policy)).value;
}

export async function saveMedia<T>(
  namespace: string,
  scope: readonly unknown[],
  value: T,
  policy?: MediaCachePolicy<T>,
  storedAt?: number,
  generation = cache.generation(),
): Promise<boolean> {
  const key = await mediaCacheKey(namespace, scope);
  return key && generation === cache.generation()
    ? cache.save(key, value, policy ?? {}, storedAt)
    : false;
}

export async function readMedia(namespace: string, scope: readonly unknown[]) {
  const key = await mediaCacheKey(namespace, scope);
  return key ? cache.peek(key) : null;
}

export const clearMediaCache = () => {
  const cleared = cache.clear();
  for (const clear of invalidators) clear();
  return cleared;
};
export const mediaCacheStats = () => cache.stats();

export function episodeCacheTtl(
  rows: readonly {
    aired?: string | null;
    airDate?: string | null;
    airdate?: string | null;
    air_date?: string | null;
    released?: string | null;
    name?: string;
    title?: string;
    canonicalTitle?: string;
  }[],
  now = Date.now(),
): number {
  let ttl = MEDIA_TTL.episodes;
  for (const row of rows) {
    const aired = Date.parse(
      row.aired ?? row.airDate ?? row.airdate ?? row.air_date ?? row.released ?? "",
    );
    if (!Number.isFinite(aired)) continue;
    if (aired > now) ttl = Math.min(ttl, Math.max(5 * 60_000, aired - now + MEDIA_TTL.recent));
    else if (
      /^(?:tba|tbd|episode\s*\d*)?$/i.test(
        (row.name ?? row.title ?? row.canonicalTitle ?? "").trim(),
      )
    )
      ttl = Math.min(ttl, MEDIA_TTL.recent);
  }
  return ttl;
}

export function metadataCacheTtl(value: unknown, now = Date.now()): number {
  if (!value || typeof value !== "object") return MEDIA_TTL.episodes;
  const raw = value as Record<string, unknown>;
  const data = raw.data && !Array.isArray(raw.data) ? (raw.data as Record<string, unknown>) : raw;
  const attrs = (data.attributes ?? data) as Record<string, unknown>;
  const status =
    typeof attrs.status === "string"
      ? attrs.status
      : (attrs.status as { name?: string } | undefined)?.name;
  const settled = /^(?:ended|finished|canceled|cancelled)$/i.test(status ?? "");
  const rows = Array.isArray(raw.episodes)
    ? raw.episodes
    : Array.isArray(raw.data)
      ? raw.data.map((row) => row.attributes ?? row)
      : "air_date" in raw
        ? [raw]
        : [];
  const episodeTtl = episodeCacheTtl(rows, now);
  return episodeTtl < MEDIA_TTL.episodes
    ? episodeTtl
    : settled
      ? MEDIA_TTL.settled
      : MEDIA_TTL.episodes;
}
