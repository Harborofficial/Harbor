import type { DownloadItem } from "@/lib/download/downloads-store";

/**
 * A manually canceled pre-download belongs to the current switch-on interval.
 * It stays stopped when the panel remounts or the same episode is revisited.
 * Switching off and on records a newer activation and permits retry.
 */
export function isManuallyStoppedForAutoPreDownload(
  download: Pick<DownloadItem, "status" | "canceledAt"> | null | undefined,
  enabledAt: number,
): boolean {
  return download?.status === "canceled" &&
    (download.canceledAt ?? 0) >= (Number.isFinite(enabledAt) ? enabledAt : 0);
}
