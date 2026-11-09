import { downloadIdentity } from "./download-group-identity";
import type { DownloadCompletionKind, DownloadCompletionRecord } from "./download-completions";

type Store = Pick<Storage, "getItem" | "setItem">;
type Completed = DownloadCompletionRecord & { batchId?: string | null };
export const GAME_COMPLETED_PREFIX = "harbor.games.game-complete-notified.v1.";
const LIMIT = 2000;

function identity(kind: DownloadCompletionKind, item: Completed) {
  return downloadIdentity(kind === "http" ? "direct" : "torrent", item);
}

/** File notifications are emitted only when the complete download group has
 * finished. The records are queried at completion, not inferred from filenames.
 * Rechecks are serialized so simultaneous final files cannot lose a notice. */
export function createGameCompletionGate(
  profile: string,
  list: (kind: DownloadCompletionKind) => Promise<Completed[]>,
  notify: (kind: DownloadCompletionKind, record: Completed) => Promise<unknown>,
  storage: Store | null,
  isCurrent: () => boolean = () => true,
) {
  const savedKey = GAME_COMPLETED_PREFIX + profile;
  const claimed = new Set<string>();
  try {
    const raw = storage?.getItem(savedKey);
    if (raw && raw.length < 600_000) {
      const json = JSON.parse(raw);
      if (json?.version === 1 && Array.isArray(json.groups) && json.groups.length <= LIMIT)
        for (const entry of json.groups)
          if (typeof entry === "string" && entry.length < 800) claimed.add(entry);
    }
  } catch {
    /* Storage is optional. */
  }
  const persist = () => {
    while (claimed.size > LIMIT) claimed.delete(claimed.values().next().value!);
    try {
      storage?.setItem(savedKey, JSON.stringify({ version: 1, groups: [...claimed] }));
    } catch {
      /* Keep in-memory deduplication when storage is unavailable. */
    }
  };
  const pending = new Map<string, Promise<void>>();
  const dirty = new Set<string>();
  const check = async (kind: DownloadCompletionKind, record: Completed) => {
    if (!isCurrent() || record.profile !== profile || record.status !== "complete") return;
    const groupKey = identity(kind, record);
    if (claimed.has(groupKey)) return;
    if (pending.has(groupKey)) {
      dirty.add(groupKey);
      return pending.get(groupKey);
    }
    const running = (async () => {
      do {
        dirty.delete(groupKey);
        let files: Completed[], torrents: Completed[];
        try {
          [files, torrents] = await Promise.all([list("http"), list("torrent")]);
        } catch {
          return;
        }
        if (!isCurrent() || claimed.has(groupKey)) return;
        const members = [
          ...files.filter(
            (item) => item.profile === profile && identity("http", item) === groupKey,
          ),
          ...torrents.filter(
            (item) => item.profile === profile && identity("torrent", item) === groupKey,
          ),
        ];
        if (
          members.length &&
          members.some((item) => item.id === record.id) &&
          members.every((item) => item.status === "complete")
        ) {
          claimed.add(groupKey);
          persist();
          if (isCurrent()) await notify(kind, record);
          return;
        }
      } while (dirty.has(groupKey) && isCurrent());
    })();
    pending.set(groupKey, running);
    try {
      await running;
    } finally {
      pending.delete(groupKey);
    }
  };
  return { check };
}
