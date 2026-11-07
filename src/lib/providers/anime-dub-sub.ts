import { safeFetch } from "@/lib/safe-fetch";

const FEED_URL =
  "https://raw.githubusercontent.com/RockinChaos/AniSchedule/master/raw/v2/dub-schedule.json";

let byMal: Set<number> | null = null;
let byAnilist: Set<number> | null = null;
let inflight: Promise<void> | null = null;
const subs = new Set<() => void>();

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
const resolvedKitsuIds = new Map<number, { mal: number | null; anilist: number | null }>();
const resolvingKitsuIds = new Map<number, Promise<void>>();

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
      for (const s of subs) s();
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
  if (!Number.isSafeInteger(kitsuId) || resolvedKitsuIds.has(kitsuId)) return;
  const existing = resolvingKitsuIds.get(kitsuId);
  if (existing) return;
  const task = (async () => {
    try {
      const { kitsuToAnilist, kitsuToMal } = await import("@/lib/providers/anime-mapping");
      const [mal, anilist] = await Promise.all([
        kitsuToMal(kitsuId).catch(() => null),
        kitsuToAnilist(kitsuId).catch(() => null),
      ]);
      resolvedKitsuIds.set(kitsuId, { mal, anilist });
      for (const listener of subs) listener();
    } catch {
      // A later render can retry if the mapping module itself fails to load.
    } finally {
      resolvingKitsuIds.delete(kitsuId);
    }
  })();
  resolvingKitsuIds.set(kitsuId, task);
}

export function dubSetReady(): boolean {
  return byMal != null;
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
  if (metaId.startsWith("mal:")) {
    const m = Number(metaId.slice(4));
    if (Number.isFinite(m) && byMal.has(m)) return true;
  }
  if (metaId.startsWith("anilist:")) {
    const a = Number(metaId.slice(8));
    if (Number.isFinite(a) && byAnilist?.has(a)) return true;
  }
  return false;
}
