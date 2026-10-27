import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { CLOUD_OK, libraryGetOne, type LibraryItem } from "@/lib/stremio";
import { isNuvioProviderActive, resolveNuvioProfileIndex } from "@/lib/nuvio/nuvio-sync";
import { readCachedNuvioPlaybackItems } from "@/lib/nuvio/nuvio-playback";
import { readCachedNuvioLibrary } from "@/lib/nuvio/nuvio-library";

// The recency capped Continue Watching list misses anything older than its top
// slice and is keyed on tt ids, so tmdb metas never match. Resolve per title
// the way the desktop detail view does.
export function useBpLibraryItem(metaId: string, imdbId: string | null): LibraryItem | null {
  const { authKey } = useAuth();
  const [item, setItem] = useState<LibraryItem | null>(null);

  useEffect(() => {
    setItem(null);
    if (metaId.startsWith("simkl:")) return;
    const candidates: string[] = [];
    if (metaId.startsWith("tt")) candidates.push(metaId);
    if (imdbId?.startsWith("tt") && !candidates.includes(imdbId)) candidates.push(imdbId);
    if (!metaId.startsWith("tt") && CLOUD_OK.test(metaId)) candidates.push(metaId);
    if (candidates.length === 0) return;

    if (isNuvioProviderActive()) {
      try {
        const slot = resolveNuvioProfileIndex();
        const playback = readCachedNuvioPlaybackItems(slot);
        const matchPlayback = playback.find((p) => candidates.includes(p._id));
        if (matchPlayback) {
          setItem(matchPlayback);
          return;
        }
        const libraryItems = readCachedNuvioLibrary(slot);
        const matchLib = libraryItems.find((l) => candidates.includes(l.content_id));
        if (matchLib) {
          setItem({
            _id: matchLib.content_id,
            type: (matchLib.content_type || "movie") as "movie" | "series",
            name: matchLib.name,
            poster: matchLib.poster ?? undefined,
            background: matchLib.background ?? undefined,
            state: {
              timeOffset: 0,
              duration: 0,
            },
            removed: false,
            temp: false,
            _ctime: matchLib.added_at ? new Date(matchLib.added_at).toISOString() : new Date().toISOString(),
            _mtime: matchLib.added_at ? new Date(matchLib.added_at).toISOString() : new Date().toISOString(),
            external: "nuvio",
          });
          return;
        }
      } catch {}
      return;
    }

    if (!authKey) return;

    let cancelled = false;
    void (async () => {
      for (const cid of candidates) {
        const found = await libraryGetOne(authKey, cid).catch(() => null);
        if (cancelled) return;
        if (found) {
          setItem(found);
          return;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authKey, metaId, imdbId]);

  return item;
}
