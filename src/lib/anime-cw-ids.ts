import {
  animeDbReadIdentities,
  animeDbWriteIdentities,
  type AnimeIdentityRecord,
} from "@/lib/anime-identity-db";

const KEY = "harbor.anime-cw-ids.v2";
const PLAY_KEY = "harbor.anime-play-ids.v1";
const LEGACY_KEY = "harbor.anime-cw-ids.v1";
const FALLBACK_KEY = "harbor.anime-cw-ids.fallback.v1";
const FALLBACK_MAX = 400;

const ANIME_SCHEME = /^(kitsu|mal|anilist|anidb):/;
const CATALOG_ID = /^(?:tt\d+|tmdb:tv:)/;
const NATIVE_ALIAS_ID = /^(?:mal|anilist|anidb):[1-9]\d*$/;
const KITSU_ID = /^kitsu:[1-9]\d*$/;
type Kind = "canonical" | "played" | "alias";

const canonical = new Map<string, string>();
const played = new Map<string, string>();
const aliases = new Map<string, string>();
const pending = new Map<string, AnimeIdentityRecord>();
const subscribers = new Set<() => void>();
let version = 0;
let flushActive = false;
let flushQueued = false;
let aliasNotifyQueued = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

function notifyAliasOnce(): void {
  if (aliasNotifyQueued) return;
  aliasNotifyQueued = true;
  void Promise.resolve().then(() => {
    aliasNotifyQueued = false;
    notify();
  });
}

function mapFor(kind: Kind): Map<string, string> {
  return kind === "canonical" ? canonical : kind === "played" ? played : aliases;
}

function valid(kind: Kind, id: string, value: string): boolean {
  if (kind === "alias") {
    return /^anilist:[1-9]\d*$/.test(id) && /^mal:[1-9]\d*$/.test(value);
  }
  if (!CATALOG_ID.test(id) && !NATIVE_ALIAS_ID.test(id)) return false;
  if (!ANIME_SCHEME.test(value)) return false;
  return !NATIVE_ALIAS_ID.test(id) || KITSU_ID.test(value);
}

function notify(): void {
  version += 1;
  for (const listener of subscribers) listener();
}

function readLegacy(key: string): Record<string, string> {
  try {
    const raw = localStorage.getItem(key);
    const value: unknown = raw ? JSON.parse(raw) : {};
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return value as Record<string, string>;
  } catch {
    return {};
  }
}

function recordOf(kind: Kind, id: string, value: string): AnimeIdentityRecord {
  return { key: `${kind}:${id}`, value, updatedAt: Date.now() };
}

function readFallback(): AnimeIdentityRecord[] {
  try {
    const raw = localStorage.getItem(FALLBACK_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (row): row is AnimeIdentityRecord =>
        !!row &&
        typeof row === "object" &&
        typeof (row as AnimeIdentityRecord).key === "string" &&
        typeof (row as AnimeIdentityRecord).value === "string",
    );
  } catch {
    return [];
  }
}

function writeFallback(): void {
  try {
    const core: AnimeIdentityRecord[] = [];
    for (const [kind, map] of [
      ["canonical", canonical],
      ["played", played],
    ] as const) {
      for (const [id, value] of map) core.push(recordOf(kind, id, value));
    }
    const aliasRows: AnimeIdentityRecord[] = [];
    for (const [id, value] of aliases) aliasRows.push(recordOf("alias", id, value));
    const coreLimit = Math.min(core.length, FALLBACK_MAX);
    const aliasLimit = Math.max(0, FALLBACK_MAX - coreLimit);
    const rows = [...core.slice(-coreLimit), ...aliasRows.slice(-aliasLimit)];
    localStorage.setItem(FALLBACK_KEY, JSON.stringify(rows));
  } catch {
    // IDB and localStorage can both be unavailable; keep the in-memory maps.
  }
}

function clearFallback(): void {
  try {
    localStorage.removeItem(FALLBACK_KEY);
  } catch {
    // harmless
  }
}

function scheduleRetry(): void {
  if (retryTimer !== null) return;
  const timer = setTimeout(() => {
    retryTimer = null;
    scheduleFlush();
  }, 5000);
  // Do not keep a Node test/process alive merely for a background cache retry.
  if (typeof timer === "object" && timer && "unref" in timer) timer.unref();
  retryTimer = timer;
}

// Recover existing CW identities immediately, before asynchronous IDB hydration.
// The old keys are only removed after the migration has committed successfully.
const legacy = new Map<string, AnimeIdentityRecord>();
for (const [kind, storageKey] of [
  ["canonical", LEGACY_KEY],
  ["canonical", KEY],
  ["played", PLAY_KEY],
] as const) {
  for (const [id, value] of Object.entries(readLegacy(storageKey))) {
    if (typeof value !== "string" || !valid(kind, id, value)) continue;
    mapFor(kind).set(id, value);
    const record = recordOf(kind, id, value);
    legacy.set(record.key, record);
  }
}

function scheduleFlush(): void {
  if (flushQueued) return;
  flushQueued = true;
  void Promise.resolve().then(async () => {
    flushQueued = false;
    await ready;
    if (flushActive) return;
    flushActive = true;
    try {
      while (pending.size > 0) {
        const batch = [...pending.values()];
        for (const row of batch) pending.delete(row.key);
        const ok = await animeDbWriteIdentities(batch);
        if (!ok) {
          for (const row of batch) if (!pending.has(row.key)) pending.set(row.key, row);
          writeFallback();
          scheduleRetry();
          break;
        }
      }
      if (pending.size === 0) clearFallback();
    } finally {
      flushActive = false;
    }
  });
}

function parseIdentityRow(row: AnimeIdentityRecord): { kind: Kind; id: string } | null {
  if (!row || typeof row.key !== "string" || typeof row.value !== "string") return null;
  const sep = row.key.indexOf(":");
  const kind = row.key.slice(0, sep) as Kind;
  const id = row.key.slice(sep + 1);
  if (!["canonical", "played", "alias"].includes(kind) || !valid(kind, id, row.value)) return null;
  return { kind, id };
}

async function hydrate(): Promise<void> {
  const stored = await animeDbReadIdentities();
  const fallback = readFallback();
  let changed = false;

  if (stored === null) {
    // IDB is unavailable. Recover the snapshot written after a failed flush,
    // and keep it pending so a later successful open can persist it.
    for (const row of fallback) {
      const parsed = parseIdentityRow(row);
      if (!parsed) continue;
      if (mapFor(parsed.kind).get(parsed.id) !== row.value) {
        mapFor(parsed.kind).set(parsed.id, row.value);
        changed = true;
      }
      if (!pending.has(row.key)) pending.set(row.key, row);
    }
    if (pending.size > 0) scheduleFlush();
    if (changed) notify();
    return;
  }

  const storedKeys = new Set<string>();
  const storedTimes = new Map<string, number>();
  for (const row of stored) {
    const parsed = parseIdentityRow(row);
    if (!parsed) continue;
    storedKeys.add(row.key);
    storedTimes.set(row.key, typeof row.updatedAt === "number" ? row.updatedAt : 0);
    // A playback/detail event recorded during hydration always takes priority.
    if (pending.has(row.key)) continue;
    if (mapFor(parsed.kind).get(parsed.id) !== row.value) {
      mapFor(parsed.kind).set(parsed.id, row.value);
      changed = true;
    }
  }

  // The fallback snapshot is newer than IDB by construction, unless another tab
  // wrote the key after the failed flush. Compare timestamps to avoid replacing
  // a newer stored value with the older recovery snapshot.
  const fallbackRows = fallback.filter((row) => {
    if (!parseIdentityRow(row) || pending.has(row.key)) return false;
    const storedAt = storedTimes.get(row.key);
    const fallbackAt = typeof row.updatedAt === "number" ? row.updatedAt : 0;
    if (storedAt != null && storedAt > fallbackAt) return false;
    const parsed = parseIdentityRow(row)!;
    if (mapFor(parsed.kind).get(parsed.id) !== row.value) {
      mapFor(parsed.kind).set(parsed.id, row.value);
      changed = true;
    }
    return true;
  });

  const migrate = [
    ...[...legacy.values()].filter((row) => !storedKeys.has(row.key) && !pending.has(row.key)),
    ...fallbackRows,
  ];
  const migrated = await animeDbWriteIdentities(migrate);
  if (migrated && pending.size === 0) {
    try {
      localStorage.removeItem(LEGACY_KEY);
      localStorage.removeItem(KEY);
      localStorage.removeItem(PLAY_KEY);
    } catch {
      // A failed cleanup is harmless: IDB is authoritative next time.
    }
    clearFallback();
  }
  if (changed) notify();
}

const ready = hydrate();

/** Wait for the first IndexedDB read; synchronous consumers subscribe to updates. */
export function animeCwIdsReady(): Promise<void> {
  return ready;
}

export function subscribeAnimeCwIds(listener: () => void): () => void {
  subscribers.add(listener);
  return () => subscribers.delete(listener);
}

export function animeCwIdsVersion(): number {
  return version;
}

/** Refresh synchronous CW consumers after checkpoint-scoped proof resolves. */
export function notifyAnimeCwIds(): void {
  notifyAliasOnce();
}

function record(kind: Kind, id: string, value: string): void {
  if (!valid(kind, id, value)) return;
  const map = mapFor(kind);
  if (map.get(id) === value) return;
  map.set(id, value);
  const entry = recordOf(kind, id, value);
  pending.set(entry.key, entry);
  if (kind === "alias") notifyAliasOnce();
  else notify();
  scheduleFlush();
}

export function recordAnilistMalAlias(anilistId: number, malId: number | null): void {
  if (
    !Number.isSafeInteger(anilistId) ||
    anilistId <= 0 ||
    malId == null ||
    !Number.isSafeInteger(malId) ||
    malId <= 0
  )
    return;
  record("alias", `anilist:${anilistId}`, `mal:${malId}`);
}

export function getAnilistMalAlias(id: string): string | null {
  return aliases.get(id) ?? null;
}

/** The entry resolved by the detail page; separate from playback's last cour. */
export function recordAnimeCwId(catalogId: string, animeId: string): void {
  record("canonical", catalogId, animeId);
}

/** The specific entry used by playback, which can differ from the catalog entry. */
export function recordAnimePlayId(catalogId: string, animeId: string): void {
  record("played", catalogId, animeId);
}

export function getAnimeCwId(catalogId: string): string | null {
  if (!CATALOG_ID.test(catalogId) && !NATIVE_ALIAS_ID.test(catalogId)) return null;
  return played.get(catalogId) ?? canonical.get(catalogId) ?? null;
}

export function getAnimeCanonicalId(catalogId: string): string | null {
  if (!CATALOG_ID.test(catalogId) && !NATIVE_ALIAS_ID.test(catalogId)) return null;
  return canonical.get(catalogId) ?? null;
}
