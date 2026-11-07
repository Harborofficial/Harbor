import { useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useProfiles } from "./profiles";
import { setItemWithRecoveryDetailed, type StorageWriteResult } from "./storage-recovery";
import { setMangaInLibrary } from "./manga/api";
import { dedupeMangaFavorites } from "./manga/favorites-cleanup";
import { notifyMangaLibraryChanged } from "./manga/library-events";
import { activeMangaSourceId, listMangaSources } from "./manga/sources";
import { MangaFavoritesContext as Ctx } from "./manga-favorites-context";

export type MangaFavEntry = {
  id: string;
  title: string;
  altTitle?: string;
  cover?: string;
  sourceId?: string;
  addedAt: number;
};

const PREFIX = "harbor.mangafav.v1.";
const keyFor = (pid: string) => PREFIX + pid;
const librarySync = new Map<string, Promise<void>>();

function syncLibrary(id: string, inLibrary: boolean, sourceId = activeMangaSourceId()): void {
  const owner = id.includes("::") ? id.slice(0, id.indexOf("::")) : sourceId;
  const source = listMangaSources().find((item) => item.id === owner);
  if (!source || source.kind !== "suwayomi") return;
  const pending = librarySync.get(id) ?? Promise.resolve();
  const next = pending
    .catch(() => {})
    .then(async () => {
      await setMangaInLibrary(id, inLibrary, sourceId, source.baseUrl);
      notifyMangaLibraryChanged();
    });
  librarySync.set(id, next);
  void next
    .catch((error) => console.warn("[manga-favorites] Suwayomi library sync failed", error))
    .finally(() => {
      if (librarySync.get(id) === next) librarySync.delete(id);
    });
}

function readMap(key: string): Map<string, MangaFavEntry> {
  const map = new Map<string, MangaFavEntry>();
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return map;
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return map;
    for (const el of arr) {
      if (el && typeof el.id === "string") {
        map.set(el.id, {
          id: el.id,
          title: typeof el.title === "string" ? el.title : "",
          altTitle: typeof el.altTitle === "string" ? el.altTitle : undefined,
          cover: typeof el.cover === "string" ? el.cover : undefined,
          sourceId: typeof el.sourceId === "string" ? el.sourceId : undefined,
          addedAt: typeof el.addedAt === "number" ? el.addedAt : 0,
        });
      }
    }
  } catch {
    return new Map();
  }
  return map;
}

function writeMap(key: string, map: Map<string, MangaFavEntry>): StorageWriteResult {
  return setItemWithRecoveryDetailed(key, JSON.stringify([...map.values()]));
}

export type MangaFavoriteToggleResult =
  | { ok: true; added: boolean }
  | { ok: false; reason: "profile-changed" }
  | { ok: false; reason: "storage"; quota: boolean };

export function mangaFavoriteFailureMessage(
  result: MangaFavoriteToggleResult,
  t: (key: string) => string,
): string | null {
  if (result.ok) return null;
  if (result.reason === "profile-changed") {
    return t("Your profile changed. Open the menu again and retry.");
  }
  return t(
    result.quota
      ? "Could not save this favorite. Check available storage and try again."
      : "Could not save this favorite. Please try again.",
  );
}

// Favorites can accumulate the same work under several source-scoped ids (one
// per source, plus legacy raw ids). Collapse them on load so old duplicate
// libraries clean themselves up, preferring an entry whose source still exists.
function loadItems(pid: string): { items: Map<string, MangaFavEntry>; cleaned: boolean } {
  const items = readMap(keyFor(pid));
  const entries = [...items.values()];
  if (entries.length < 2) return { items, cleaned: false };
  const live = new Set(listMangaSources().map((source) => source.id));
  const deduped = dedupeMangaFavorites(entries, live);
  if (deduped.length === entries.length) return { items, cleaned: false };
  return { items: new Map(deduped.map((entry) => [entry.id, entry])), cleaned: true };
}

function qualifiedFavoriteId(id: string, sourceId: string): string {
  return id.includes("::") || !sourceId || sourceId === "all" ? id : `${sourceId}::${id}`;
}

function storedFavoriteKey(
  items: Map<string, MangaFavEntry>,
  id: string,
  sourceId: string,
): string | undefined {
  const qualified = qualifiedFavoriteId(id, sourceId);
  if (qualified.includes("::") && items.has(qualified)) return qualified;
  const separator = id.indexOf("::");
  const raw = separator < 0 ? id : id.slice(separator + 2);
  const owner = separator < 0 ? sourceId : id.slice(0, separator);
  const legacy = items.get(raw);
  // Legacy raw IDs without source metadata can only be removed explicitly
  // from their own library card; never guess a provider from today's selection.
  return legacy && (legacy.sourceId ?? "") === owner ? raw : undefined;
}

export type MangaFavoritesStore = {
  items: Map<string, MangaFavEntry>;
  has: (id: string, sourceId?: string) => boolean;
  toggle: (input: {
    id: string;
    title?: string;
    altTitle?: string;
    cover?: string;
    sourceId?: string;
  }) => MangaFavoriteToggleResult;
  /** Self-heals a stale entry after it re-resolves to a live id/cover. */
  repair: (
    oldId: string,
    next: { id: string; title?: string; altTitle?: string; cover?: string; sourceId?: string },
  ) => void;
  count: number;
};

export function MangaFavoritesProvider({ children }: { children: ReactNode }) {
  const { activeId } = useProfiles();
  const pid = activeId ?? "default";
  const [stored, setStored] = useState(() => {
    const { items } = loadItems(pid);
    return { pid, items };
  });
  const items = useMemo(
    () => (stored.pid === pid ? stored.items : loadItems(pid).items),
    [stored, pid],
  );
  const current = useRef({ pid, items });
  current.current = { pid, items };
  useEffect(() => {
    const { items, cleaned } = loadItems(pid);
    if (cleaned) writeMap(keyFor(pid), items);
    setStored({ pid, items });
  }, [pid]);

  const value = useMemo<MangaFavoritesStore>(
    () => ({
      items,
      has: (id, sourceId = activeMangaSourceId()) =>
        storedFavoriteKey(items, id, sourceId) !== undefined,
      toggle: (input) => {
        if (current.current.pid !== pid) {
          console.warn("[manga-favorites] favorite toggle failed", {
            category: "profile-changed",
          });
          return { ok: false, reason: "profile-changed" };
        }
        const next = new Map(current.current.items);
        const sourceId = input.sourceId ?? activeMangaSourceId();
        const existing = storedFavoriteKey(next, input.id, sourceId);
        const removing = existing !== undefined;
        if (existing !== undefined) {
          next.delete(existing);
        } else {
          const id = qualifiedFavoriteId(input.id, sourceId);
          next.set(id, {
            id,
            title: input.title ?? "",
            altTitle: input.altTitle,
            cover: input.cover,
            sourceId,
            addedAt: Date.now(),
          });
        }
        const saved = writeMap(keyFor(pid), next);
        if (!saved.ok) {
          console.warn("[manga-favorites] favorite toggle failed", {
            category: "storage",
            exceptionName: saved.errorName ?? "QuotaExceededError",
            quota: saved.quota,
            recovered: saved.recovered,
          });
          return { ok: false, reason: "storage", quota: saved.quota };
        }
        syncLibrary(input.id, !removing, sourceId);
        current.current = { pid, items: next };
        setStored({ pid, items: next });
        return { ok: true, added: !removing };
      },
      repair: (oldId, update) => {
        if (current.current.pid !== pid) return;
        const entry = current.current.items.get(oldId);
        if (!entry) return;
        const sourceId = update.id.includes("::")
          ? update.id.slice(0, update.id.indexOf("::"))
          : (update.sourceId ?? entry.sourceId ?? "");
        const id = qualifiedFavoriteId(update.id, sourceId);
        if (
          id === oldId &&
          (update.cover ?? entry.cover) === entry.cover &&
          (update.title ?? entry.title) === entry.title &&
          (update.altTitle ?? entry.altTitle) === entry.altTitle &&
          sourceId === (entry.sourceId ?? "")
        ) {
          return;
        }
        const next = new Map(current.current.items);
        next.delete(oldId);
        const existing = next.get(id);
        next.set(id, {
          ...entry,
          id,
          title: update.title ?? entry.title,
          altTitle: update.altTitle ?? entry.altTitle,
          cover: update.cover ?? entry.cover,
          sourceId: sourceId || undefined,
          addedAt: existing ? Math.min(existing.addedAt, entry.addedAt) : entry.addedAt,
        });
        if (!writeMap(keyFor(pid), next).ok) return;
        current.current = { pid, items: next };
        setStored({ pid, items: next });
        // Keep the server library pointing at the live id so it stays openable.
        if (id !== oldId) syncLibrary(id, true, sourceId);
      },
      count: items.size,
    }),
    [items, pid],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useMangaFavorites(): MangaFavoritesStore {
  const v = useContext(Ctx);
  if (!v) throw new Error("manga favorites used outside its provider");
  return v;
}

export function useIsMangaFavorite(id?: string, sourceId?: string): boolean {
  const { has } = useMangaFavorites();
  return !!id && has(id, sourceId);
}

export function removeMangaFavorites(pid: string): void {
  try {
    localStorage.removeItem(keyFor(pid));
  } catch {
    return;
  }
}
