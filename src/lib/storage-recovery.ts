// Prunable means the network or a recomputation can give it back. Anything the user did stays,
// even when it is the biggest thing in the store: playback history, last season, live-TV watch
// counts and manual EPG matches, Discover's learned affinity, the legacy parental pin, the build
// rating. Open the module that owns a key before adding it here — backup.ts groups by prefix, so
// its sections mix real records with caches and cannot answer this on their own. Keys of a few KB
// are not worth the risk either way; this list is for what actually fills the store.
const PRUNABLE_EXACT = new Set<string>([
  "harbor.omdb.v1",
  "harbor.omdb.misses",
  "harbor.omdb.budget",
  "harbor.iptv.hydration.v2",
  "harbor.dead-streams.v1",
  "harbor.discover.events.v1",
  "harbor.discover.awards.v1",
  "harbor.discover.rows.v1",
  "harbor.scroll.v1",
  "harbor.webhook.lastTick",
  "harbor.calendar.webhook.last",
  "harbor.imdb.tmdb.v1",
  "harbor.tmdb.imdb.v1",
  "harbor.tmdb.personName.v1",
  "harbor.animefillercache.v2",
  "harbor.malscorecache",
  "harbor.anime.recs_by_mal.v1",
  "harbor.anime.mal_id_by_franchise.v1",
  "harbor.shows.hero.pool.v2",
  "harbor.mdblist.cards",
  "harbor.stremio-addons.velocity.v1",
  "harbor.streamBadges.v1",
  "harbor.manga.popular.v1",
  "harbor.ebook.metadata.v1",
  "harbor.ebook.nyt.v1",
  "harbor.heroPool.v1",
  "harbor.mal.hero.v1",
  "harbor.anime.art.v2",
  "harbor.anime.hero.hosted.v5",
]);

// Prefixes, not exact keys, for every cache whose owner version-stamps it: pinning a version
// here means the live cache silently stops being prunable the day someone bumps it, which is
// how seven of these ended up unreachable.
const PRUNABLE_PREFIXES = [
  "harbor.anidbtvdbcache",
  "harbor.armcache",
  "harbor.armkitsucache",
  "harbor.armsrcmalcache",
  "harbor.extkitsucache",
  "harbor.jikancatalog",
  "harbor.anime_awards.metas.",
  "harbor.anime.toppicks.cache.",
  "harbor.awards.wikidata.v",
  "harbor.graph.wikidata.",
  "harbor.libraryNameRepair.v1.",
  "harbor.anilist.collection.v1.",
  "harbor.manga.cache.v1.",
  "harbor.manga.cache.v2.",
  "harbor.manga.art.",
  "harbor.ebook.openlibrary.v1.",
  "harbor.ebook.openlibrary.v2.",
  "harbor.sports.board.v3:",
  "harbor.tvdbo.",
];

function isPrunable(key: string): boolean {
  if (PRUNABLE_EXACT.has(key)) return true;
  return PRUNABLE_PREFIXES.some((p) => key.startsWith(p));
}

function prunableEntries(): Array<{ key: string; size: number }> {
  const out: Array<{ key: string; size: number }> = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !isPrunable(key)) continue;
    const v = localStorage.getItem(key);
    if (v == null) continue;
    out.push({ key, size: v.length + key.length });
  }
  out.sort((a, b) => b.size - a.size);
  return out;
}

function isQuotaError(e: unknown): boolean {
  if (e instanceof DOMException) {
    if (e.name === "QuotaExceededError") return true;
    if (e.name === "NS_ERROR_DOM_QUOTA_REACHED") return true;
    if (e.code === 22) return true;
    if (e.code === 1014) return true;
  }
  return false;
}

function pruneOne(key: string): number {
  try {
    const cur = localStorage.getItem(key);
    if (cur == null) return 0;
    const freed = cur.length + key.length;
    localStorage.removeItem(key);
    console.info(`[storage] pruned "${key}" to free ${freed} chars`);
    return freed;
  } catch {
    return 0;
  }
}

const SNAP_PREFIX = "harbor.snap.";
const SNAP_KEEP = new Set(["harbor.snap.index", "harbor.snap.retention"]);

function snapshotFrames(): Array<{ key: string; size: number }> {
  const out: Array<{ key: string; size: number }> = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith(SNAP_PREFIX) || SNAP_KEEP.has(key)) continue;
    const v = localStorage.getItem(key);
    if (v == null) continue;
    out.push({ key, size: v.length + key.length });
  }
  out.sort((a, b) => b.size - a.size);
  return out;
}

export function setItemWithRecovery(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (e) {
    if (!isQuotaError(e)) throw e;
  }
  const evictable = [...prunableEntries(), ...snapshotFrames()];
  for (const { key: candidate } of evictable) {
    if (candidate === key) continue;
    pruneOne(candidate);
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (e) {
      if (!isQuotaError(e)) throw e;
    }
  }
  // Replacing a value can still fail at the quota boundary because WebView storage
  // reserves the new value before releasing the old one. Retry non-destructively by
  // temporarily removing the previous value, and restore it if the replacement fails.
  let previous: string | null = null;
  try {
    previous = localStorage.getItem(key);
    if (previous != null) {
      localStorage.removeItem(key);
      try {
        localStorage.setItem(key, value);
        return true;
      } catch (e) {
        try {
          localStorage.setItem(key, previous);
        } catch {
          console.error(`[storage] could not restore "${key}" after replacement failed`);
        }
        if (!isQuotaError(e)) throw e;
      }
    }
  } catch (e) {
    if (!isQuotaError(e)) throw e;
  }
  console.warn(`[storage] giving up on "${key}" after pruning every cache`);
  return false;
}

export function freeStorageSpace(): { freedBytes: number; pruned: string[] } {
  let freed = 0;
  const pruned: string[] = [];
  for (const { key } of prunableEntries()) {
    const n = pruneOne(key);
    if (n > 0) {
      freed += n;
      pruned.push(key);
    }
  }
  return { freedBytes: freed, pruned };
}

const pendingCritical = new Map<string, string>();
let flushBound = false;

function bindCriticalFlush(): void {
  if (flushBound || typeof window === "undefined") return;
  flushBound = true;
  const flush = () => {
    if (pendingCritical.size === 0) return;
    for (const [k, v] of pendingCritical) {
      if (setItemWithRecovery(k, v)) pendingCritical.delete(k);
    }
  };
  window.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
  window.addEventListener("pagehide", flush);
}

export function persistCritical(key: string, value: string): boolean {
  bindCriticalFlush();
  const ok = setItemWithRecovery(key, value);
  if (ok) {
    pendingCritical.delete(key);
  } else {
    pendingCritical.set(key, value);
    console.error(`[storage] critical key "${key}" did not persist; will retry before close`);
  }
  return ok;
}

const PROACTIVE_PER_KEY_THRESHOLD = 256 * 1024;
const PROACTIVE_TOTAL_THRESHOLD = 3.5 * 1024 * 1024;

const DEAD_CACHE_PREFIXES = ["harbor.picker-cache."];
const VERSIONED_CACHE_PREFIXES = ["harbor.awards.wikidata", "harbor.anime_awards.metas"];

const LRU_PREFIX_CAPS: Array<{ prefix: string; keep: number }> = [
  { prefix: "harbor.tvdbo.", keep: 24 },
];

function capLruPrefixes(): void {
  for (const { prefix, keep } of LRU_PREFIX_CAPS) {
    const found: Array<{ key: string; size: number }> = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(prefix)) continue;
      const v = localStorage.getItem(k);
      if (v == null) continue;
      found.push({ key: k, size: v.length });
    }
    if (found.length <= keep) continue;
    found.sort((a, b) => b.size - a.size);
    for (const f of found.slice(keep)) pruneOne(f.key);
  }
}

function purgeDeadCaches(): void {
  const kill: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && DEAD_CACHE_PREFIXES.some((p) => k.startsWith(p))) kill.push(k);
  }
  for (const k of kill) pruneOne(k);
}

function purgeOldCacheVersions(): void {
  for (const prefix of VERSIONED_CACHE_PREFIXES) {
    const re = new RegExp(`^${prefix.replace(/\./g, "\\.")}\\.v(\\d+)$`);
    const found: Array<{ key: string; v: number }> = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      const m = re.exec(k);
      if (m) found.push({ key: k, v: Number(m[1]) });
    }
    if (found.length < 2) continue;
    const max = Math.max(...found.map((f) => f.v));
    for (const f of found) if (f.v < max) pruneOne(f.key);
  }
}

const PROBE_KEY = "harbor.storage.probe";

/**
 * The size thresholds below only measure what is prunable, so a store filled mostly by
 * keys we never prune stays under them while every write already throws. Ask the store
 * itself instead.
 */
function storageRejectsWrites(): boolean {
  try {
    localStorage.setItem(PROBE_KEY, "1");
    localStorage.removeItem(PROBE_KEY);
    return false;
  } catch (e) {
    return isQuotaError(e);
  }
}

/**
 * Boot only: the store already rejects every write, so free just enough to get going again.
 * Dropping every cache instead would cost the user a full refetch of the home feed to buy
 * headroom nothing is asking for.
 */
function freeUntilWritable(): void {
  for (const { key } of prunableEntries()) {
    pruneOne(key);
    if (!storageRejectsWrites()) return;
  }
}

export function proactiveStorageCleanup(): void {
  if (typeof localStorage === "undefined") return;
  purgeDeadCaches();
  purgeOldCacheVersions();
  capLruPrefixes();
  const entries = prunableEntries();
  let total = 0;
  for (const { key, size } of entries) {
    total += size;
    if (size > PROACTIVE_PER_KEY_THRESHOLD) pruneOne(key);
  }
  if (total > PROACTIVE_TOTAL_THRESHOLD) {
    const r = freeStorageSpace();
    console.info(
      `[storage] proactive total cleanup: ${r.pruned.length} caches, ${r.freedBytes} bytes`,
    );
  } else if (storageRejectsWrites()) {
    freeUntilWritable();
  }
}
