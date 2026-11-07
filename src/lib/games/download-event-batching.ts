export function isImportantDownloadEvent(
  previous: { status: string; error?: string | null } | undefined,
  next: { status: string; error?: string | null },
): boolean {
  return !previous || previous.status !== next.status || previous.error !== next.error;
}
export const DOWNLOAD_PROGRESS_UI_INTERVAL = 800;
