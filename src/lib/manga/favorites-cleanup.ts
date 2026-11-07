import { mangaTitleKey } from "./title";

export type FavoriteEntry = {
  id: string;
  title: string;
  altTitle?: string;
  cover?: string;
  sourceId?: string;
  addedAt: number;
};

function ownerOf(entry: FavoriteEntry): string {
  if (entry.sourceId) return entry.sourceId;
  const separator = entry.id.indexOf("::");
  return separator < 0 ? "" : entry.id.slice(0, separator);
}

function liveRank(entry: FavoriteEntry, liveSources: ReadonlySet<string>): number {
  return liveSources.has(ownerOf(entry)) ? 1 : 0;
}

function better(a: FavoriteEntry, b: FavoriteEntry, liveSources: ReadonlySet<string>): boolean {
  const liveA = liveRank(a, liveSources);
  const liveB = liveRank(b, liveSources);
  if (liveA !== liveB) return liveB > liveA;
  return b.addedAt > a.addedAt;
}

function sameCover(a: FavoriteEntry, b: FavoriteEntry): boolean {
  return !!a.cover && !!b.cover && a.cover.trim() === b.cover.trim();
}

function sameAltTitle(a: FavoriteEntry, b: FavoriteEntry): boolean {
  const altA = a.altTitle ? mangaTitleKey(a.altTitle) : "";
  const altB = b.altTitle ? mangaTitleKey(b.altTitle) : "";
  return !!altA && altA === altB;
}

function sameSource(a: FavoriteEntry, b: FavoriteEntry): boolean {
  const ownerA = ownerOf(a);
  return !!ownerA && ownerA === ownerOf(b);
}

// Two entries that share a title are only collapsed when something else ties
// them to the same work. Distinct manga can share a name, so a bare title
// match must never delete one of them.
function corroborates(a: FavoriteEntry, b: FavoriteEntry): boolean {
  return sameCover(a, b) || sameAltTitle(a, b) || sameSource(a, b);
}

function mergeCluster<T extends FavoriteEntry>(cluster: readonly T[], liveSources: ReadonlySet<string>): T {
  let winner = cluster[0];
  for (const entry of cluster.slice(1)) {
    if (better(winner, entry, liveSources)) winner = entry;
  }
  return cluster.reduce<T>(
    (merged, entry) => ({
      ...merged,
      title: merged.title || entry.title,
      altTitle: merged.altTitle || entry.altTitle,
      cover: merged.cover || entry.cover,
    }),
    winner,
  );
}

/**
 * Favorites are keyed by source-qualified id, so the same work can be saved
 * under several ids (one per source, plus legacy raw ids). Collapse only the
 * entries that share a title AND a second identity signal: the same cover,
 * the same alt title, or the same provider. Untitled entries are kept as-is.
 */
export function dedupeMangaFavorites<T extends FavoriteEntry>(
  entries: readonly T[],
  liveSources: ReadonlySet<string>,
): T[] {
  const byTitle = new Map<string, T[]>();
  const untitled: T[] = [];
  for (const entry of entries) {
    const key = mangaTitleKey(entry.title);
    if (!key) {
      untitled.push(entry);
      continue;
    }
    const group = byTitle.get(key);
    if (group) group.push(entry);
    else byTitle.set(key, [entry]);
  }
  const out: T[] = [];
  for (const group of byTitle.values()) {
    if (group.length === 1) {
      out.push(group[0]);
      continue;
    }
    const clusters: T[][] = [];
    for (const entry of group) {
      const cluster = clusters.find((items) => items.some((item) => corroborates(item, entry)));
      if (cluster) cluster.push(entry);
      else clusters.push([entry]);
    }
    for (const cluster of clusters) out.push(mergeCluster(cluster, liveSources));
  }
  return [...out, ...untitled];
}
