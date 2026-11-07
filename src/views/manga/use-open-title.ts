import { useRef, useState } from "react";
import { useMangaFavorites } from "@/lib/manga-favorites";
import { resolveMangaOpen } from "@/lib/manga/open-resolve";
import { hasAnyMangaSource } from "@/lib/manga/sources";
import { useView } from "@/lib/view";

/** Opens a saved favorite, re-resolving stale or source-less ids by title. */
export function useOpenTitle() {
  const { openManga } = useView();
  const favorites = useMangaFavorites();
  const busyRef = useRef<Set<string>>(new Set());
  const [missing, setMissing] = useState<Set<string>>(() => new Set());
  const open = async (id: string, title: string, altTitle?: string, sourceId?: string) => {
    if (busyRef.current.has(id)) return;
    const name = title.trim();
    if (!name || !hasAnyMangaSource()) {
      openManga(id);
      return;
    }
    busyRef.current.add(id);
    setMissing((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    try {
      const resolved = await resolveMangaOpen({
        id: sourceId && !id.includes("::") ? `${sourceId}::${id}` : id,
        title: name,
        altTitle,
      });
      if (!resolved) {
        setMissing((prev) => new Set(prev).add(id));
        return;
      }
      const entry = favorites.items.get(id);
      if (
        resolved.id !== id ||
        resolved.cover !== entry?.cover ||
        resolved.title !== entry?.title
      ) {
        favorites.repair(id, { id: resolved.id, title: resolved.title, cover: resolved.cover });
      }
      openManga(resolved.id);
    } finally {
      busyRef.current.delete(id);
    }
  };
  return { open, missing };
}
