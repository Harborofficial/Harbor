import type { MediaServerCollection } from "./types";

export function filterMediaServerCollections(
  collections: MediaServerCollection[],
  query: string,
  memberIdsByCollection: Map<string, Set<string>>,
  titleByItemKey: Map<string, string>,
): MediaServerCollection[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return collections;

  return collections.filter((collection) => {
    if (collection.name.toLowerCase().includes(needle)) return true;
    const ids = memberIdsByCollection.get(`${collection.connectionId}:${collection.id}`);
    if (!ids) return false;
    for (const id of ids) {
      if (titleByItemKey.get(id)?.toLowerCase().includes(needle)) return true;
    }
    return false;
  });
}
