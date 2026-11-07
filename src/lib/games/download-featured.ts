import type { GameDownloadBundle } from "./download-game-groups";

/** A slot's position is physical (0 = left, 1 = right). Its age changes only
 * when a different game is featured, never with noisy progress updates. */
/** Queue and paused must be distinct so explicit resume is observable.
 * "waiting" is only for migration of version 2 saved settings. */
type FeaturedStatus = "running" | "queued" | "paused" | "inactive" | "waiting";
export type FeaturedPin = { key: string; order: number };
export type FeaturedSlots = [FeaturedPin | null, FeaturedPin | null];
export type FeaturedState = {
  slots: FeaturedSlots;
  seen: Record<string, FeaturedStatus>;
  order: number;
  initialized: boolean;
  /** Highest creation timestamp observed by the always-mounted Games
   * workspace, used when restoring featured slots from persisted state. */
  lastSeenCreatedAt: number | null;
};
export const FEATURED_LIMIT = 2;
export const featuredStorageKey = (profile: string) =>
  "harbor.games.featured-downloads.v1:" + encodeURIComponent(profile);

export function emptyFeaturedState(): FeaturedState {
  return { slots: [null, null], seen: {}, order: 0, initialized: false, lastSeenCreatedAt: null };
}

export function restoreFeaturedSlots(raw: string | null): FeaturedState {
  const state = emptyFeaturedState();
  if (!raw || raw.length > 120_000) return state;
  try {
    const data = JSON.parse(raw);
    if (![1, 2, 3].includes(data?.version) || !Array.isArray(data.slots) || data.slots.length !== 2)
      return state;
    const used = new Set<string>();
    for (let i = 0; i < 2; i++) {
      const pin = data.slots[i];
      if (pin == null) continue;
      if (
        typeof pin.key !== "string" ||
        !pin.key ||
        pin.key.length > 750 ||
        !Number.isSafeInteger(pin.order) ||
        pin.order < 1 ||
        pin.order > Number.MAX_SAFE_INTEGER / 2 ||
        used.has(pin.key)
      )
        return emptyFeaturedState();
      state.slots[i] = { key: pin.key, order: pin.order };
      state.order = Math.max(state.order, pin.order);
      used.add(pin.key);
    }
    if (data.version >= 2) {
      if (Number.isSafeInteger(data.lastSeenCreatedAt) && data.lastSeenCreatedAt >= 0)
        state.lastSeenCreatedAt = data.lastSeenCreatedAt;
      if (data.version === 2 && Array.isArray(data.known) && data.known.length <= 256) {
        for (const key of data.known)
          if (typeof key === "string" && key.length > 0 && key.length <= 750)
            state.seen[key] = "waiting";
      }
      if (
        data.version === 3 &&
        data.seen &&
        typeof data.seen === "object" &&
        !Array.isArray(data.seen) &&
        Object.keys(data.seen).length <= 256
      ) {
        for (const [key, status] of Object.entries(data.seen))
          if (
            key.length > 0 &&
            key.length <= 750 &&
            ["paused", "queued", "running", "inactive", "waiting"].includes(status as string)
          )
            state.seen[key] = status as FeaturedStatus;
      }
    }
  } catch {
    return emptyFeaturedState();
  }
  return state;
}

export function serializeFeaturedSlots(state: FeaturedState): string {
  // Keep a bounded snapshot of observed group IDs. The timestamp alone
  // cannot distinguish two downloads created within the same HTTP second.
  const pinned = state.slots.flatMap((pin) => (pin ? [pin.key] : []));
  const known = [...new Set([...pinned, ...Object.keys(state.seen)])].slice(0, 256);
  const seen = Object.fromEntries(
    known.flatMap((key) => (state.seen[key] ? [[key, state.seen[key]]] : [])),
  );
  return JSON.stringify({
    version: 3,
    slots: state.slots,
    lastSeenCreatedAt: state.lastSeenCreatedAt ?? 0,
    seen,
  });
}

const activeStatuses = new Set([
  "connecting",
  "retrying",
  "downloading",
  "checking",
  "pausing",
  "canceling",
]);

export function featuredStatus(group: GameDownloadBundle): FeaturedStatus {
  const statuses = group.items.map((item) => item.record.status);
  if (statuses.some((status) => activeStatuses.has(status))) return "running";
  if (statuses.includes("queued")) return "queued";
  if (statuses.includes("paused")) return "paused";
  return "inactive";
}

/** Seconds for HTTP records, milliseconds for torrents. Creation time only:
 * never use updatedAt or progress to rank a featured game. */
export function featuredCreatedAt(group: GameDownloadBundle): number {
  const created = group.items.flatMap((item) => {
    const value = item.record.createdAt;
    return Number.isFinite(value) && value > 0
      ? [item.kind === "direct" ? value * 1000 : value]
      : [];
  });
  // Additional files in an existing repack shouldn't make an older game
  // appear to be a newly created download.
  return created.length ? Math.min(...created) : 0;
}

function candidates(groups: readonly GameDownloadBundle[]): GameDownloadBundle[] {
  return groups
    .filter((group) => featuredStatus(group) !== "inactive")
    .sort((a, b) => featuredCreatedAt(a) - featuredCreatedAt(b) || a.key.localeCompare(b.key));
}

/** A newly added or explicitly resumed game replaces the older featured
 * slot; background progress and queue churn do not change card positions. */
export function reconcileFeaturedSlots(
  previous: FeaturedState,
  groups: readonly GameDownloadBundle[],
): FeaturedState {
  const byKey = new Map(groups.map((group) => [group.key, group]));
  const slots: [FeaturedPin | null, FeaturedPin | null] = previous.slots.map((pin) =>
    pin && byKey.has(pin.key) && featuredStatus(byKey.get(pin.key)!) !== "inactive" ? pin : null,
  ) as FeaturedSlots;
  const seen: FeaturedState["seen"] = {};
  for (const group of groups) seen[group.key] = featuredStatus(group);
  let order = previous.order;
  const selected = new Set(slots.filter((pin): pin is FeaturedPin => !!pin).map((pin) => pin.key));
  const add = (key: string) => {
    if (selected.has(key)) return;
    let index = slots.findIndex((pin) => pin === null);
    if (index < 0) index = slots[0]!.order <= slots[1]!.order ? 0 : 1;
    if (slots[index]) selected.delete(slots[index]!.key);
    slots[index] = { key, order: ++order };
    selected.add(key);
  };
  const pool = candidates(groups);
  // Keep the user's two most recently featured positions. Progress events
  // never change the slots. Starting or resuming a game that is not already
  // featured takes the *older featured slot*, regardless of when it was added.
  if (selected.size === 0) {
    for (const group of pool.slice(-FEATURED_LIMIT)) add(group.key);
  } else {
    // On a legacy v1/v2 saved state, repair the old creation-time-only pinning.
    // New v3 saves preserve an intentionally resumed older featured game.
    if (!previous.initialized && previous.lastSeenCreatedAt === null) {
      for (const group of pool.filter((group) => !selected.has(group.key))) {
        const stamp = featuredCreatedAt(group);
        const oldest = slots[0]!.order <= slots[1]!.order ? 0 : 1;
        const original = byKey.get(slots[oldest]!.key)!;
        if (stamp > featuredCreatedAt(original)) add(group.key);
      }
    }
    const missing = slots.filter((pin) => !pin).length;
    if (missing > 0)
      for (const group of pool.filter((group) => !selected.has(group.key)).slice(-missing))
        add(group.key);
    // React can mount after a download starts on another tab. The saved
    // per-group state lets us still detect a paused -> queued/running resume.
    // Queued -> running by itself is not a resume, so background scheduling
    // never causes left/right swapping.
    const incoming = pool.filter(
      (group) =>
        !selected.has(group.key) &&
        (() => {
          const was = previous.seen[group.key];
          const now = seen[group.key];
          if (previous.initialized && !was) return true; // new game
          if (was === "paused" && (now === "queued" || now === "running")) return true;
          if (
            was === "waiting" &&
            featuredCreatedAt(group) >
              Math.min(
                ...slots
                  .filter((pin): pin is FeaturedPin => !!pin)
                  .map((pin) => featuredCreatedAt(byKey.get(pin.key)!)),
              )
          )
            return true;
          return was === "inactive" && now === "running";
        })(),
    );
    for (const group of incoming) add(group.key);
    // On a cold mount, recognize genuinely new downloads that were not in
    // the persisted snapshot, without evicting manually resumed older pins.
    if (!previous.initialized && previous.lastSeenCreatedAt !== null) {
      for (const group of pool.filter(
        (group) =>
          !selected.has(group.key) &&
          !Object.hasOwn(previous.seen, group.key) &&
          featuredCreatedAt(group) >= previous.lastSeenCreatedAt!,
      ))
        add(group.key);
    }
  }
  const lastSeenCreatedAt = Math.max(
    previous.lastSeenCreatedAt ?? 0,
    ...groups.map((group) => featuredCreatedAt(group)),
  );
  return { slots, seen, order, initialized: true, lastSeenCreatedAt };
}

/** Used by the hook to avoid React updates during normal download progress. */
export function sameFeaturedState(a: FeaturedState, b: FeaturedState): boolean {
  return (
    a.initialized === b.initialized &&
    a.order === b.order &&
    a.lastSeenCreatedAt === b.lastSeenCreatedAt &&
    a.slots.every((pin, i) => pin?.key === b.slots[i]?.key && pin?.order === b.slots[i]?.order) &&
    Object.keys(a.seen).length === Object.keys(b.seen).length &&
    Object.entries(a.seen).every(([key, status]) => b.seen[key] === status)
  );
}

export function featuredStatusSignature(groups: readonly GameDownloadBundle[]): string {
  return groups
    .map((group) => JSON.stringify([group.key, featuredStatus(group), featuredCreatedAt(group)]))
    .sort()
    .join("|");
}

/** Return featured games in exact saved slot order, with everything else
 * untouched in its normal section (including displaced active downloads). */
export function placeFeaturedDownloads(
  groups: readonly GameDownloadBundle[],
  keys: readonly string[],
): { featured: GameDownloadBundle[]; list: GameDownloadBundle[] } {
  const byKey = new Map(groups.map((group) => [group.key, group]));
  const featured = keys.flatMap((key) => {
    const group = byKey.get(key);
    return group ? [group] : [];
  });
  const selected = new Set(featured.map((group) => group.key));
  return { featured, list: groups.filter((group) => !selected.has(group.key)) };
}
