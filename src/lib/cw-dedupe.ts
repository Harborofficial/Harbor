import { animeTitleKeys } from "@/lib/anime-title-key";
import { cardCoords } from "@/lib/cw-card-coords";
import { franchiseDedupKey } from "@/lib/providers/jikan";
import { readResumeEntry } from "@/lib/resume";
import type { LibraryItem } from "@/lib/stremio";

function episodeRank(i: LibraryItem): number {
  const coords = cardCoords(i);
  const season = coords?.season ?? i.state?.season ?? 0;
  const episode = coords?.episode ?? i.state?.episode ?? 0;
  return season >= 1 && episode >= 1 ? season * 100_000 + episode : -1;
}

/** Actual playback time; `_mtime` also moves for library maintenance. */
function playbackAt(i: LibraryItem): number {
  const lastWatched = Date.parse(i.state?.lastWatched ?? "");
  if (Number.isFinite(lastWatched) && lastWatched > 0) return lastWatched;
  const resume = readResumeEntry(i._id, i.state?.season, i.state?.episode);
  return resume?.t ?? 0;
}

function progressRatio(i: LibraryItem): number {
  const duration = i.state?.duration ?? 0;
  return duration > 0 ? Math.min(1, (i.state?.timeOffset ?? 0) / duration) : 0;
}

/** The most recently watched copy wins; episode order and progress break ties. */
export function isFurther(incoming: LibraryItem, existing: LibraryItem): boolean {
  const incomingAt = playbackAt(incoming);
  const existingAt = playbackAt(existing);
  if (incomingAt !== existingAt) return incomingAt > existingAt;
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

/** A series can arrive as series, anime, tv or channel depending on its source. */
function typeKey(type: string): string {
  return type === "series" || type === "anime" || type === "tv" || type === "channel"
    ? "series"
    : type;
}

export function itemIds(i: LibraryItem): string[] {
  return [i._id, ...(i.altIds ?? [])].filter(Boolean);
}

/** Stored name plus any title the card resolved and displayed for this checkpoint. */
export function titleKeys(item: LibraryItem): string[] {
  const prefix = typeKey(item.type);
  const checkpoint = {
    videoId: item.state?.video_id,
    season: item.state?.season,
    episode: item.state?.episode,
    imdbId:
      item.altIds?.find((id) => /^tt\d+$/.test(id)) ??
      (/^tt\d+$/.test(item._id) ? item._id : undefined),
  };
  const keys = [...animeTitleKeys(item._id, checkpoint)];
  if (item.name) keys.push(franchiseDedupKey(item.name));
  return [...new Set(keys)].filter(Boolean).map((key) => `${prefix}|${key}`);
}

function sharesContentId(a: LibraryItem, b: LibraryItem): boolean {
  const ids = new Set(itemIds(b));
  return itemIds(a).some((id) => ids.has(id));
}

/** Keep every source checkpoint so dismissing the survivor clears all copies. */
function mergeCopies(survivor: LibraryItem, copy: LibraryItem): LibraryItem {
  const members = [...(survivor.cwMembers ?? [survivor]), ...(copy.cwMembers ?? [copy])];
  const unique = [...new Map(members.map((member) => [memberKey(member), member])).values()];
  // Only called for copies that share a content id, so the copy's own id is a
  // verified alias of the survivor.
  const altIds = [
    ...new Set([...(survivor.altIds ?? []), ...(copy.altIds ?? []), copy._id]),
  ].filter((id) => id !== survivor._id);
  return {
    ...survivor,
    altIds: altIds.length > 0 ? altIds : undefined,
    cwMembers: unique,
  };
}

// Cloud, local and tracker rows can carry a different id for the same title, so
// matching on the id alone can show one title twice. Collapse them by type and
// franchise name, keeping the furthest episode instead of the first one seen.
//
// Only a shared content id proves two records are the same title. A name match
// hides the duplicate but must never join `cwMembers` or `altIds`: those decide
// which records a dismissal wipes, and a title collision (two shows named
// "The Office") would otherwise clear the other show's saved progress.
export function dedupeCwItems(items: LibraryItem[], limit: number): LibraryItem[] {
  const idIndex = new Map<string, number>();
  const aliasIndex = new Map<string, number>();
  const nameIndex = new Map<string, number>();
  const out: LibraryItem[] = [];
  const replaceShown = (existing: LibraryItem, item: LibraryItem) =>
    typeKey(existing.type) === "series" &&
    typeKey(item.type) === "series" &&
    isFurther(item, existing);
  for (const item of items) {
    const keys = titleKeys(item);
    const verified = itemIds(item)
      .map((id) => idIndex.get(id))
      .find((value) => value != null);
    const index =
      verified ??
      itemIds(item)
        .map((id) => aliasIndex.get(id))
        .find((value) => value != null) ??
      keys.map((key) => nameIndex.get(key)).find((value) => value != null);
    if (index == null) {
      if (out.length >= limit) continue;
      const next = out.length;
      out.push(item);
      for (const id of itemIds(item)) idIndex.set(id, next);
      for (const key of keys) nameIndex.set(key, next);
      continue;
    }
    const existing = out[index];
    // Identity is judged against the card that is actually shown: sharing a
    // content id verifies the pair, whichever index found it.
    if (!sharesContentId(item, existing)) {
      // Track the ids so a later copy of this duplicate still finds the card,
      // without promoting them to verified aliases.
      for (const id of itemIds(item)) aliasIndex.set(id, index);
      // Showing the further episode is a display choice; the dropped copy keeps
      // its own progress and its own provider ids.
      if (replaceShown(existing, item)) out[index] = item;
      continue;
    }
    // Episode order only applies to series. Movie copies keep the first
    // (freshness-sorted) row, as before, and just retain their members.
    out[index] = replaceShown(existing, item)
      ? mergeCopies(item, existing)
      : mergeCopies(existing, item);
    for (const id of itemIds(out[index])) idIndex.set(id, index);
  }
  return out;
}
