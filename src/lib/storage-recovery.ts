// What may be evicted when the store is full. Prunable means the network or a recomputation can
// give it back; anything the user made or did stays, however big it is: playback history, last
// season, live-TV watch counts and manual EPG matches, Discover's learned affinity, uploaded
// stream badges and their rules, the legacy parental pin, the build rating, completed library
// repairs, and OMDb's daily request budget. Open the module that
// owns a key before adding it here - backup.ts groups by prefix, so its sections mix real records
// with caches and cannot answer this on their own. Keys of a few KB are not worth the risk either
// way; this list is for what actually fills the store.
//
// These are prefixes, and stop before any version stamp on purpose. Pinning a version means the
// live cache silently stops being prunable the day its owner bumps it, which is how seven of
// these were unreachable until now.
const PRUNABLE_PREFIXES = [
  // Only OMDb's rating and negative-result caches are rebuildable. The daily
  // request budget and key-validity state must survive recovery.
  "harbor.omdb.v",
  "harbor.omdb.misses",
  "harbor.iptv.hydration.v",
  "harbor.dead-streams.v",
  "harbor.discover.events.v",
  "harbor.discover.awards.v",
  "harbor.discover.rows.v",
  "harbor.scroll.v",
  "harbor.webhook.lastTick",
  "harbor.calendar.webhook.last",
  "harbor.anidbtvdbcache",
  "harbor.armcache",
  "harbor.armkitsucache",
  "harbor.armsrcmalcache",
  "harbor.extkitsucache",
  "harbor.jikancatalog",
  "harbor.imdb.tmdb.v",
  "harbor.tmdb.imdb.v",
  "harbor.tmdb.personName.v",
  "harbor.awards.wikidata.v",
  "harbor.graph.wikidata.",
  "harbor.anime_awards.metas.",
  "harbor.animefillercache.v",
  "harbor.malscorecache",
  "harbor.anime.recs_by_mal.v",
  "harbor.anime.toppicks.cache.",
  "harbor.anime.mal_id_by_franchise.v",
  "harbor.anime.art.v",
  "harbor.anime.hero.hosted.v",
  "harbor.anilist.collection.v",
  "harbor.shows.hero.pool.v",
  "harbor.heroPool.v",
  "harbor.mal.hero.v",
  "harbor.mdblist.cards",
  "harbor.stremio-addons.velocity.v",
  "harbor.manga.popular.v",
  "harbor.manga.cache.v",
  "harbor.manga.art.",
  "harbor.ebook.metadata.v",
  "harbor.ebook.nyt.v",
  "harbor.ebook.openlibrary.v",
  "harbor.sports.board.v",
  "harbor.tvdbo.",
];

function isPrunable(key: string): boolean {
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
/** Room for one more character proves nothing: the next boot write is a settings or profile
 *  blob, so ask for enough space to land one of those. */
const PROBE_CHARS = 32 * 1024;

/**
 * The size thresholds below only measure what is prunable, so a store filled mostly by
 * keys we never prune stays under them while every write already throws. Ask the store
 * itself instead.
 */
function storageRejectsWrites(): boolean {
  try {
    localStorage.setItem(PROBE_KEY, "x".repeat(PROBE_CHARS));
    localStorage.removeItem(PROBE_KEY);
    return false;
  } catch (e) {
    localStorage.removeItem(PROBE_KEY);
    return isQuotaError(e);
  }
}

/**
 * Boot only: the store cannot take a realistic write, so free until it can and stop there.
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
  // Runs before createRoot, so a storage that is blocked or corrupt rather than merely full
  // must not reject mount() - that leaves the boot splash up with nothing behind it.
  try {
    pruneUntilUsable();
  } catch (e) {
    console.warn("[storage] proactive cleanup skipped", e);
  }
}

function pruneUntilUsable(): void {
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
