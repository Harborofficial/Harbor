import { safeFetch } from "@/lib/safe-fetch";

const FEED_URL =
  "https://raw.githubusercontent.com/RockinChaos/AniSchedule/master/raw/v2/dub-schedule.json";

let byMal: Set<number> | null = null;
let byAnilist: Set<number> | null = null;
let inflight: Promise<void> | null = null;
const subs = new Set<() => void>();
const DUB_KITSU_MISS_TTL_MS = 5 * 60 * 1000;
const DUB_KITSU_HIT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type DubSetSnapshot = { ready: boolean; version: number };
let snapshot: DubSetSnapshot = { ready: false, version: 0 };

export type DubFeedEntry = {
  id?: number | null;
  idMal?: number | null;
  format?: string | null;
  isAdult?: boolean | null;
  title?: { romaji?: string | null; english?: string | null; native?: string | null } | null;
  coverImage?: { extraLarge?: string | null; medium?: string | null; color?: string | null } | null;
  bannerImage?: string | null;
  airingSchedule?: { nodes?: Array<{ episode?: number | null; airingAt?: number | string | null }> | null } | null;
};

let feedCache: { entries: DubFeedEntry[]; at: number } | null = null;
const FEED_STALE_MS = 30 * 60 * 1000;
const resolvedKitsuIds = new Map<number, { mal: number | null; anilist: number | null; at: number; }>();
const resolvingKitsuIds = new Map<number, Promise<void>>();

function notifySubscribers(): void {
  snapshot = { ready: byMal != null, version: snapshot.version + 1 };
  for (const listener of subs) listener();
}

/** Fetch the AniSchedule dub feed, cached briefly. Never rejects. */
export async function fetchDubSchedule(): Promise<DubFeedEntry[]> {
  const now = Date.now();
  if (feedCache && now - feedCache.at < FEED_STALE_MS) return feedCache.entries;
  try {
    const res = await safeFetch(FEED_URL);
    if (!res.ok) return feedCache?.entries ?? [];
    const arr = (await res.json()) as DubFeedEntry[];
    feedCache = { entries: arr, at: now };
    return arr;
  } catch {
    return feedCache?.entries ?? [];
  }
}

function load(): Promise<void> {
  if (byMal) return Promise.resolve();
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const arr = await fetchDubSchedule();
      const mal = new Set<number>();
      const ani = new Set<number>();
      for (const e of arr) {
        const m = e?.idMal;
        const a = e?.id;
        if (typeof m === "number") mal.add(m);
        if (typeof a === "number") ani.add(a);
      }
      byMal = mal;
      byAnilist = ani;
      notifySubscribers();
    } catch {
      /* leave sets null; badge stays hidden */
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export function ensureDubSet(): void {
  void load();
}

/** Resolve Kitsu cards through the shared, persistent anime mapping cache. */
export function ensureDubForAnimeId(metaId: string | number | undefined): void {
  ensureDubSet();
  if (typeof metaId !== "string") return;
  const match = /^kitsu:(\d+)/.exec(metaId);
  if (!match) return;
  const kitsuId = Number(match[1]);
  if (!Number.isSafeInteger(kitsuId)) return;
  const cached = resolvedKitsuIds.get(kitsuId);
  if (cached) {
    const hasMapping = cached.mal != null || cached.anilist != null;
    const ttl = hasMapping ? DUB_KITSU_HIT_TTL_MS : DUB_KITSU_MISS_TTL_MS;
    if (Date.now() - cached.at < ttl) return;
    resolvedKitsuIds.delete(kitsuId);
  }
  const existing = resolvingKitsuIds.get(kitsuId);
  if (existing) return;
  const task = (async () => {
    try {
      const { kitsuToAnilist, kitsuToMal } = await import("@/lib/providers/anime-mapping");
      const [mal, anilist] = await Promise.all([
        kitsuToMal(kitsuId).catch(() => null),
        kitsuToAnilist(kitsuId).catch(() => null),
      ]);
      resolvedKitsuIds.set(kitsuId, { mal, anilist, at: Date.now() });
    } catch {
      resolvedKitsuIds.set(kitsuId, { mal: null, anilist: null, at: Date.now() });
    } finally {
      resolvingKitsuIds.delete(kitsuId);
      notifySubscribers();
    }
  })();
  resolvingKitsuIds.set(kitsuId, task);
}

export function dubSetReady(): boolean {
  return byMal != null;
}

export function dubSetSnapshot(): DubSetSnapshot {
  return snapshot;
}

export function subscribeDubSet(fn: () => void): () => void {
  subs.add(fn);
  return () => {
    subs.delete(fn);
  };
}

export function animeHasDub(metaId: string | undefined): boolean {
  if (!byMal) return false;
  if (metaId == null) return false;
  const kitsu = /^kitsu:(\d+)/.exec(metaId);
  if (kitsu) {
    const mapped = resolvedKitsuIds.get(Number(kitsu[1]));
    return (
      !!mapped &&
      ((mapped.mal != null && byMal.has(mapped.mal)) ||
        (mapped.anilist != null && !!byAnilist?.has(mapped.anilist)))
    );
  }
  const mal = /^mal:(\d+)/.exec(metaId);
  if (mal) {
    const m = Number(mal[1]);
    if (Number.isFinite(m) && byMal.has(m)) return true;
  }
  const anilist = /^anilist:(\d+)/.exec(metaId);
  if (anilist) {
    const a = Number(anilist[1]);
    if (Number.isFinite(a) && byAnilist?.has(a)) return true;
  }
  return false;
}
