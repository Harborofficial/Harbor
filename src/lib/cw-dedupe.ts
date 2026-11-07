import { franchiseDedupKey } from "@/lib/providers/jikan";
import type { LibraryItem } from "@/lib/stremio";

// Cloud, local and tracker rows can carry a different id for the same title, so
// matching on the id alone can show one title twice. This mirrors the desktop
// home dedupe: first by id, then by type and franchise name.
export function dedupeCwItems(items: LibraryItem[], limit: number): LibraryItem[] {
  const seen = new Set<string>();
  const seenName = new Set<string>();
  const out: LibraryItem[] = [];
  for (const i of items) {
    if (seen.has(i._id)) continue;
    const nameKey = `${i.type}|${franchiseDedupKey(i.name ?? "")}`;
    if (i.name && seenName.has(nameKey)) continue;
    seen.add(i._id);
    if (i.name) seenName.add(nameKey);
    out.push(i);
    if (out.length >= limit) break;
  }
  return out;
}
