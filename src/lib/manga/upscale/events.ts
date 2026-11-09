// A prefetched page may finish after its PageImage has mounted. This event lets
// that page apply the cached result immediately instead of waiting to become
// visible, so pages are already sharp when they scroll in.
export const MANGA_PAGE_CACHED_EVENT = "manga-upscale:page-cached";

export type MangaPageCachedDetail = { key: string };

export function notifyMangaPageCached(key: string) {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new CustomEvent(MANGA_PAGE_CACHED_EVENT, { detail: { key } }));
  } catch {
    // Notifications are best effort.
  }
}
