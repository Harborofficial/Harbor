import { idbCacheGet, idbCacheSet } from "@/lib/idb-cache";

const DURABLE_PREFIX = "harbor.membership.durable.v1:";
const SAVED_AT_SUFFIX = ".savedAt.v1";

export type MembershipMirror<T> = { at: number; data: T };

export function membershipSavedAtKey(storageKey: string): string {
  return `${storageKey}${SAVED_AT_SUFFIX}`;
}

export function readMembershipSavedAt(storageKey: string): number {
  try {
    const value = Number(localStorage.getItem(membershipSavedAtKey(storageKey)));
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

function writeMembershipSavedAt(storageKey: string, at: number): void {
  try {
    localStorage.setItem(membershipSavedAtKey(storageKey), String(at));
  } catch {
    // The mirror keeps the timestamp; a full localStorage may refuse this small key.
  }
}

/**
 * Mirror a snapshot to IndexedDB. The localStorage timestamp is written only when the
 * caller knows localStorage actually accepted the same snapshot; otherwise an older
 * local copy would masquerade as the newer one on the next launch.
 */
export function mirrorMembershipSnapshot<T>(
  storageKey: string,
  containers: T,
  at = Date.now(),
  markLocal = true,
): void {
  if (markLocal) writeMembershipSavedAt(storageKey, at);
  void idbCacheSet(`${DURABLE_PREFIX}${storageKey}`, { at, data: containers }).catch(() => {});
}

export async function readMembershipMirror<T>(
  storageKey: string,
): Promise<MembershipMirror<T> | null> {
  const record = await idbCacheGet(`${DURABLE_PREFIX}${storageKey}`).catch(() => null);
  if (!record || typeof record.at !== "number") return null;
  return record as MembershipMirror<T>;
}
