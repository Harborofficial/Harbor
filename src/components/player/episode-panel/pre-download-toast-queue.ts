/** Toggle confirmations are brief; download progress and completion need longer. */
export function preDownloadToastDurationMs(kind: string): number {
  return kind === "enabled" || kind === "disabled" ? 1200 : 2800;
}

export type PreDownloadToastItem<K extends string> = {
  id: number;
  kind: K;
  label: string;
};

/** Toggle feedback takes precedence. Automatic events wait their turn
 * instead of replacing the icon before its animation can finish. */
export function enqueuePreDownloadToast<K extends string>(
  queue: readonly PreDownloadToastItem<K>[],
  next: PreDownloadToastItem<K>,
): PreDownloadToastItem<K>[] {
  if (next.kind === "enabled" || next.kind === "disabled") return [next];
  if (queue.some((item) => item.kind === next.kind && item.label === next.label)) return [...queue];
  return [...queue.slice(0, 4), next];
}

/** The notification preference affects only UI feedback, never download work. */
export function visiblePreDownloadToast<K extends string>(
  queue: readonly PreDownloadToastItem<K>[],
  notificationsEnabled: boolean,
): PreDownloadToastItem<K> | null {
  return notificationsEnabled ? (queue[0] ?? null) : null;
}

/** A stale timer must never dismiss the newly shown notification. */
export function dismissPreDownloadToast<K extends string>(
  queue: readonly PreDownloadToastItem<K>[],
  id: number,
): PreDownloadToastItem<K>[] {
  return queue[0]?.id === id ? queue.slice(1) : [...queue];
}
