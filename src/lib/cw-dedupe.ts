import { franchiseDedupKey } from "@/lib/providers/jikan";
import type { LibraryItem } from "@/lib/stremio";

function episodeRank(i: LibraryItem): number {
  const season = i.state?.season ?? 0;
  const episode = i.state?.episode ?? 0;
  return season >= 1 && episode >= 1 ? season * 100_000 + episode : -1;
}

function progressRatio(i: LibraryItem): number {
  const duration = i.state?.duration ?? 0;
  return duration > 0 ? Math.min(1, (i.state?.timeOffset ?? 0) / duration) : 0;
}

/** The newer episode wins; on the same episode, further progress wins. */
function isFurther(incoming: LibraryItem, existing: LibraryItem): boolean {
  const incomingRank = episodeRank(incoming);
  const existingRank = episodeRank(existing);
  if (incomingRank !== existingRank) return incomingRank > existingRank;
  return progressRatio(incoming) > progressRatio(existing);
}

function memberKey(i: LibraryItem): string {
  return [
    i._id,
    i.external,
    i.local,
    i.state?.video_id,
    i.state?.season,
    i.state?.episode,
    i.state?.timeOffset,
  ]
    .map((value) => String(value ?? ""))
    .join("|");
}

/** Keep every source checkpoint so dismissing the survivor clears all copies. */
function mergeCopies(survivor: LibraryItem, copy: LibraryItem): LibraryItem {
  const members = [...(survivor.cwMembers ?? [survivor]), ...(copy.cwMembers ?? [copy])];
  const unique = [...new Map(members.map((member) => [memberKey(member), member])).values()];
  return { ...survivor, cwMembers: unique };
}

// Cloud, local and tracker rows can carry a different id for the same title, so
// matching on the id alone can show one title twice. Collapse them by type and
// franchise name, keeping the furthest episode instead of the first one seen.
export function dedupeCwItems(items: LibraryItem[], limit: number): LibraryItem[] {
  const idIndex = new Map<string, number>();
  const nameIndex = new Map<string, number>();
  const out: LibraryItem[] = [];
  for (const item of items) {
    const nameKey = item.name ? `${item.type}|${franchiseDedupKey(item.name)}` : null;
    const index = idIndex.get(item._id) ?? (nameKey ? nameIndex.get(nameKey) : undefined);
    if (index == null) {
      if (out.length >= limit) continue;
      const next = out.length;
      out.push(item);
      idIndex.set(item._id, next);
      if (nameKey) nameIndex.set(nameKey, next);
      continue;
    }
    const existing = out[index];
    // Episode order only applies to series. Movie copies keep the first
    // (freshness-sorted) row, as before, and just retain their members.
    const replace =
      existing.type === "series" && item.type === "series" && isFurther(item, existing);
    out[index] = replace ? mergeCopies(item, existing) : mergeCopies(existing, item);
    idIndex.set(item._id, index);
  }
  return out;
}
