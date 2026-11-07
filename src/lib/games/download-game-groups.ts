import type { DownloadItem, DownloadGroup } from "./download-presentation";
import { downloadGame, downloadGroup } from "./download-presentation";
import { transferProgressBytes } from "./transfer-relink";
import { downloadIdentity } from "./download-group-identity";

/** Keep different profiles and known game identities separate. Do not guess
 * identities from matching filenames, which can belong to unrelated releases. */
export function downloadGroupKey(item: DownloadItem): string {
  return downloadIdentity(item.kind, item.record);
}

export type GameDownloadBundle = {
  key: string;
  name: string;
  items: DownloadItem[];
  state: DownloadGroup;
  received: number;
  total: number | null;
  rate: number;
  latestAt: number;
  completed: number;
};

const priority: DownloadGroup[] = ["active", "queue", "attention", "complete", "canceled"];

export function bundleDownloads(
  items: readonly DownloadItem[],
  classify: (item: DownloadItem) => DownloadGroup = downloadGroup,
): GameDownloadBundle[] {
  const map = new Map<string, GameDownloadBundle>();
  for (const item of items) {
    const key = downloadGroupKey(item);
    let group = map.get(key);
    if (!group) {
      group = {
        key,
        name: downloadGame(item.record)?.name ?? item.record.name,
        items: [],
        state: "canceled",
        received: 0,
        total: 0,
        rate: 0,
        latestAt: 0,
        completed: 0,
      };
      map.set(key, group);
    }
    group.items.push(item);
    const status = classify(item);
    if (priority.indexOf(status) < priority.indexOf(group.state)) group.state = status;
    group.latestAt = Math.max(group.latestAt, item.record.updatedAt);
    if (item.record.status === "complete") group.completed++;
    const progress =
      item.kind === "torrent"
        ? { received: item.record.received, total: item.record.totalBytes }
        : transferProgressBytes(item.record);
    group.received += Math.max(0, progress.received);
    if (group.total !== null)
      group.total = progress.total === null ? null : group.total + progress.total;
    // A replacement CDN link first streams the saved prefix to verify it.
    // That is genuine network activity, even though no new file bytes are
    // written yet. Show its bandwidth instead of falsely reporting 0 B/s.
    if (
      item.record.status === "downloading" ||
      (item.kind === "direct" &&
        item.record.status === "checking" &&
        item.record.checkingPartial != null)
    )
      group.rate += Math.max(0, item.record.bytesPerSecond);
  }
  return [...map.values()].sort(
    (a, b) => priority.indexOf(a.state) - priority.indexOf(b.state) || b.latestAt - a.latestAt,
  );
}

/** Verify status is not equivalent to downloading new bytes. Keep file and
 * group labels accurate while a refreshed CDN link is comparing saved data. */
export function groupVerification(group: Pick<GameDownloadBundle, "items">) {
  const checks = group.items.filter(
    (item): item is Extract<DownloadItem, { kind: "direct" }> =>
      item.kind === "direct" &&
      item.record.status === "checking" &&
      item.record.checkingPartial != null,
  );
  const total = checks.reduce((sum, item) => sum + item.record.received, 0);
  const received = checks.reduce(
    (sum, item) => sum + Math.min(item.record.received, item.record.checkingPartial ?? 0),
    0,
  );
  const speed = checks.reduce((sum, item) => sum + Math.max(0, item.record.bytesPerSecond), 0);
  return checks.length ? { count: checks.length, total, received, speed } : null;
}
export function groupStatusKey(group: GameDownloadBundle) {
  const verifying = groupVerification(group);
  const checking = group.items.some((item) => item.record.status === "checking");
  if (verifying || checking) {
    const downloading = group.items.some((item) => item.record.status === "downloading");
    if (downloading) return "games.download.relink.downloadingAndVerifying";
    return verifying ? "games.download.relink.checking" : "games.download.relink.finalVerification";
  }
  return "games.download.center." + group.state;
}
export function groupSectionStatusKey(
  section: DownloadGroup,
  groups: readonly GameDownloadBundle[],
) {
  if (section !== "active") return "games.download.center." + section;
  if (!groups.some((group) => group.items.some((item) => item.record.status === "checking")))
    return "games.download.center.active";
  return groups.every((group) =>
    ["games.download.relink.checking", "games.download.relink.finalVerification"].includes(
      groupStatusKey(group),
    ),
  )
    ? "games.download.relink.checking"
    : "games.download.relink.downloadingAndVerifying";
}

/** A group can contain multiple files, and only one record may carry the
 * artwork metadata. Prefer that record for the full-width active banner. */
export function groupArtworkItem(group: Pick<GameDownloadBundle, "items">): DownloadItem {
  return group.items.find((item) => !!downloadGame(item.record)?.artwork) ?? group.items[0];
}

export type GroupDownloadAction = "pause" | "resume";

/** A mixed group pauses what is running before offering resume.
 * Completed/canceled files are never requeued. */
export function groupDownloadAction(
  group: Pick<GameDownloadBundle, "items">,
): { action: GroupDownloadAction; items: DownloadItem[] } | null {
  const pausable = group.items.filter((item) =>
    item.kind === "torrent"
      ? ["queued", "checking", "downloading"].includes(item.record.status)
      : ["queued", "connecting", "retrying", "downloading", "checking"].includes(
          item.record.status,
        ),
  );
  if (pausable.length) return { action: "pause", items: pausable };
  const resumable = group.items.filter((item) => ["paused", "failed"].includes(item.record.status));
  return resumable.length ? { action: "resume", items: resumable } : null;
}
