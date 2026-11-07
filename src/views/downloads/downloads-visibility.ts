import type { DownloadItem } from "@/lib/download/downloads-store";

export type DownloadsFilter = "all" | "active" | "saved" | "issues" | "canceled";

/** Canceled transfers are retained in the store for retry/deletion and to
 * honor manual cancellation, but should not clutter the default Downloads view. */
export function matchesDownloadFilter(
  item: Pick<DownloadItem, "status">,
  filter: DownloadsFilter,
): boolean {
  if (filter === "canceled") return item.status === "canceled";
  if (item.status === "canceled") return false;
  if (filter === "active") return item.status === "downloading" || item.status === "paused";
  if (filter === "saved") return item.status === "done";
  if (filter === "issues") return item.status === "error" || item.status === "interrupted";
  return true;
}
