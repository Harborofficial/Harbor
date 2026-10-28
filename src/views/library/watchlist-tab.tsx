import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useSettings } from "@/lib/settings";
import { type Meta } from "@/lib/cinemeta";
import { library, libraryMetaType, removeStremioBookmark, type LibraryItem } from "@/lib/stremio";
import { fetchWatchlist } from "@/lib/trakt/watchlist";
import { useTrakt } from "@/lib/trakt/provider";
import { traktItemToMeta } from "@/lib/trakt/to-meta";
import type { TraktItem } from "@/lib/trakt/types";
import { stremioIdToTraktTarget } from "@/lib/trakt/ids";
import { removeFromWatchlist as removeTraktWatchlist } from "@/lib/trakt/watchlist";
import { stremioIdToSimklTarget } from "@/lib/simkl/ids";
import { removeFromWatchlist as removeSimklWatchlist } from "@/lib/simkl/watchlist";
import { isAuthenticated as simklConnected } from "@/lib/simkl/session";
import {
  evictWatchlistAggregate,
  readLocalEntries,
  removeFromWatchlist,
  removeFromWatchlistEntry,
  subscribeWatchlist,
  type LocalEntry,
} from "@/lib/watchlist";
import { setStremioAggregate, setNuvioAggregate, refreshWatchlistAggregates } from "@/lib/watchlist-sync";
import { resolveNuvioProfileIndex } from "@/lib/nuvio/nuvio-sync";
import { getNuvioAccountId } from "@/lib/nuvio/nuvio-client";
import {
  readCachedNuvioLibrary,
  pullNuvioLibrarySnapshot,
  removeNuvioLibraryItem,
  flushNuvioLibraryMutations,
  subscribeNuvioLibrary,
  type NuvioLibraryItem,
} from "@/lib/nuvio/nuvio-library";
import { useT } from "@/lib/i18n";
import {
  applyFilter,
  countByType,
  EmptyWatchlist,
  FilterBar,
  GroupedGrid,
  groupByDate,
  parseTs,
  SortControl,
  sortedGroups,
  type TypeKey,
  type WatchlistMerged,
} from "./shared";
import { useReportFeatured } from "./featured-context";

export function WatchlistTab({
  mode,
  scrollRef,
}: {
  mode: "library" | "watchlist";
  scrollRef?: React.RefObject<HTMLElement | null>;
}) {
  const tr = useT();
  const { authKey } = useAuth();
  const { settings } = useSettings();
  const { isConnected: traktConnected } = useTrakt();
  const isNuvio = settings.accountProvider === "nuvio";
  const [stremio, setStremio] = useState<LibraryItem[]>([]);
  const [nuvioItems, setNuvioItems] = useState<NuvioLibraryItem[]>(() => {
    if (settings.accountProvider !== "nuvio") return [];
    const slot = resolveNuvioProfileIndex();
    return readCachedNuvioLibrary(slot);
  });
  const [rawCount, setRawCount] = useState(() => {
    if (settings.accountProvider === "nuvio") {
      const slot = resolveNuvioProfileIndex();
      return readCachedNuvioLibrary(slot).length;
    }
    return 0;
  });
  const [trakt, setTrakt] = useState<TraktItem[]>([]);
  const [localEntries, setLocalEntries] = useState<LocalEntry[]>(() => readLocalEntries());
  const [traktStatus, setTraktStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  // Bumped on every removal. Fetch completions capture the value at start and
  // revalidate instead of applying when a removal landed mid-flight, so a
  // stale response can never resurrect a just-removed card for a beat.
  const guardSeq = useRef(0);
  const pendingRemovals = useRef(0);
  const [refreshSeq, setRefreshSeq] = useState(0);

  useEffect(() => {
    let cancelled = false;
    if (isNuvio) {
      let requestSeq = 0;
      const loadNuvio = () => {
        if (cancelled || pendingRemovals.current > 0) return;
        const seq = ++requestSeq;
        const mySeq = guardSeq.current;
        const accountId = getNuvioAccountId();
        const slot = resolveNuvioProfileIndex();
        const cached = readCachedNuvioLibrary(slot);
        setRawCount(cached.length);
        setNuvioItems(cached);
        setNuvioAggregate(cached.map((i) => i.content_id).filter(Boolean));

        pullNuvioLibrarySnapshot(slot)
          .then((fresh) => {
            if (
              cancelled ||
              seq !== requestSeq ||
              getNuvioAccountId() !== accountId ||
              resolveNuvioProfileIndex() !== slot
            ) return;
            if (guardSeq.current !== mySeq) {
              loadNuvio();
              return;
            }
            setRawCount(fresh.length);
            setNuvioItems(fresh);
            setNuvioAggregate(fresh.map((i) => i.content_id).filter(Boolean));
          })
          .catch(() => {});
      };
      loadNuvio();

      const onChange = () => {
        setLocalEntries(readLocalEntries());
        loadNuvio();
      };
      window.addEventListener("harbor:nuvio-profile-changed", onChange);
      window.addEventListener("harbor:nuvio-state-changed", onChange);
      const unsub = subscribeNuvioLibrary(onChange);
      const unsubWatchlist = subscribeWatchlist(onChange);
      return () => {
        cancelled = true;
        window.removeEventListener("harbor:nuvio-profile-changed", onChange);
        window.removeEventListener("harbor:nuvio-state-changed", onChange);
        unsub();
        unsubWatchlist();
      };
    }

    const loadStremio = () => {
      if (!authKey || cancelled || pendingRemovals.current > 0) return;
      const mySeq = guardSeq.current;
      library(authKey)
        .then((items) => {
          if (cancelled) return;
          if (guardSeq.current !== mySeq) {
            loadStremio();
            return;
          }
          setRawCount(items.filter((i) => !i.removed).length);
          setStremio(filterLibrary(items, settings.libraryBookmarkedOnly, mode));
          setStremioAggregate(items.filter((i) => !i.removed && !i.temp).map((i) => i._id));
        })
        .catch(() => {});
    };
    loadStremio();
    // Re-read the Stremio library on any watchlist change (e.g. removal from
    // a detail page), otherwise its card lingers until the next app restart.
    const onChange = () => {
      setLocalEntries(readLocalEntries());
      loadStremio();
    };
    window.addEventListener("storage", onChange);
    const unsub = subscribeWatchlist(onChange);
    return () => {
      cancelled = true;
      window.removeEventListener("storage", onChange);
      unsub();
    };
  }, [authKey, settings.libraryBookmarkedOnly, mode, refreshSeq, isNuvio]);

  const handleRemove = useCallback(
    async (stremioId: string) => {
      const isNuvioActive = settings?.accountProvider === "nuvio";
      if (isNuvioActive) {
        guardSeq.current += 1;
        const slot = resolveNuvioProfileIndex();
        const allLocals = readLocalEntries();
        const cleanId = stremioId.trim();

        // Target ONLY this item and its twin local/IMDb ID
        const targetIds = new Set<string>([cleanId]);
        const localMatch = allLocals.find((l) => l.id === cleanId || (l.imdbId && l.imdbId === cleanId));
        if (localMatch) {
          if (localMatch.id) targetIds.add(localMatch.id);
          if (localMatch.imdbId) targetIds.add(localMatch.imdbId);
        }

        // 1. Optimistic UI removal (0ms instant)
        evictWatchlistAggregate(targetIds);
        setNuvioItems((prev) => prev.filter((i) => !targetIds.has(i.content_id)));
        setLocalEntries((prev) => prev.filter((e) => !targetIds.has(e.id)));
        setTrakt((prev) =>
          prev.filter((t) => {
            const tk = traktTmdbForm(t.type, t.ids.tmdb);
            return !((t.ids.imdb && targetIds.has(t.ids.imdb)) || (tk && targetIds.has(tk)));
          }),
        );
        setRawCount((c) => Math.max(0, c - 1));

        // 2. Queue exact Nuvio removals
        const item =
          nuvioItems.find((x) => targetIds.has(x.content_id)) ||
          readCachedNuvioLibrary(slot).find((x) => targetIds.has(x.content_id));
        const contentType = item?.content_type || localMatch?.type || "movie";

        for (const tid of targetIds) {
          removeNuvioLibraryItem(slot, tid, contentType);
        }
        if (localMatch) {
          removeFromWatchlist(localMatch.id);
        }

        // 3. Background flush & third-party tracking sync (non-blocking)
        const tr = stremioIdToTraktTarget(cleanId);
        const simklTarget = (() => {
          if (!simklConnected()) return null;
          const sr = stremioIdToSimklTarget(cleanId);
          return sr.ok ? sr.target : null;
        })();

        void Promise.allSettled([
          flushNuvioLibraryMutations(slot),
          ...(tr.ok ? [removeTraktWatchlist(tr.target).catch(() => false)] : []),
          ...(simklTarget ? [removeSimklWatchlist(simklTarget).catch(() => false)] : []),
        ]);
        return;
      }

      if (!authKey) return;
      guardSeq.current += 1;
      pendingRemovals.current += 1;
      const allLocals = readLocalEntries();
      const closure = filmClosure([stremioId], allLocals, trakt);
      evictWatchlistAggregate(closure);
      const twins = allLocals.filter((l) => closure.has(l.id));
      setStremio((prev) => prev.filter((i) => !closure.has(i._id)));
      setLocalEntries((prev) => prev.filter((e) => !closure.has(e.id)));
      setTrakt((prev) =>
        prev.filter((t) => {
          const tk = traktTmdbForm(t.type, t.ids.tmdb);
          return !((t.ids.imdb && closure.has(t.ids.imdb)) || (tk && closure.has(tk)));
        }),
      );
      setRawCount((c) => Math.max(0, c - 1));
      try {
        const tr = stremioIdToTraktTarget(stremioId);
        const simklTarget = (() => {
          if (!simklConnected()) return null;
          const sr = stremioIdToSimklTarget(stremioId);
          return sr.ok ? sr.target : null;
        })();
        const results = await Promise.allSettled([
          ...Array.from(
            new Set([
              stremioId,
              ...stremio.filter((item) => closure.has(item._id)).map((item) => item._id),
            ]),
            (id) => removeStremioBookmark(authKey, id),
          ),
          ...(tr.ok ? [removeTraktWatchlist(tr.target).catch(() => false)] : []),
          ...(simklTarget ? [removeSimklWatchlist(simklTarget).catch(() => false)] : []),
        ]);
        if (results.some((result) => result.status === "rejected"))
          throw new Error("Watchlist removal failed");
        for (const l of twins) removeFromWatchlist(l.id);
      } catch {
        setLocalEntries(readLocalEntries());
      } finally {
        pendingRemovals.current -= 1;
        guardSeq.current += 1;
        setRefreshSeq((value) => value + 1);
      }
      const revalidate = () => {
        const s = guardSeq.current;
        const isCurrent = () => guardSeq.current === s && pendingRemovals.current === 0;
        void refreshWatchlistAggregates(authKey, traktConnected, simklConnected(), isCurrent)
          .then((items) => {
            if (!isCurrent()) return;
            setTrakt(items);
          })
          .catch(() => {});
      };
      revalidate();
    },
    [authKey, settings.libraryBookmarkedOnly, mode, stremio, trakt, traktConnected],
  );

  const handleRemoveLocal = useCallback(
    (localId: string) => {
      const all = readLocalEntries();
      const e = all.find((x) => x.id === localId);
      if (!e) return;
      guardSeq.current += 1;

      if (isNuvio) {
        const slot = resolveNuvioProfileIndex();
        const targetIds = new Set<string>([e.id]);
        if (e.imdbId) targetIds.add(e.imdbId);

        evictWatchlistAggregate(targetIds);
        setLocalEntries((prev) => prev.filter((x) => !targetIds.has(x.id)));
        setNuvioItems((prev) => prev.filter((i) => !targetIds.has(i.content_id)));
        setRawCount((c) => Math.max(0, c - 1));

        for (const tid of targetIds) {
          removeNuvioLibraryItem(slot, tid, e.type);
        }
        void flushNuvioLibraryMutations(slot);

        removeFromWatchlistEntry({
          id: e.id,
          type: e.type,
          name: e.name,
          poster: e.poster,
          imdbId: e.imdbId ?? null,
        });
        return;
      }

      const closure = filmClosure(e.imdbId ? [e.id, e.imdbId] : [e.id], all, trakt);
      evictWatchlistAggregate(closure);
      setLocalEntries((prev) => prev.filter((x) => !closure.has(x.id)));
      setStremio((prev) => prev.filter((i) => !closure.has(i._id)));
      setTrakt((prev) =>
        prev.filter((t) => {
          const tk = traktTmdbForm(t.type, t.ids.tmdb);
          return !((t.ids.imdb && closure.has(t.ids.imdb)) || (tk && closure.has(tk)));
        }),
      );
      removeFromWatchlistEntry({
        id: e.id,
        type: e.type,
        name: e.name,
        poster: e.poster,
        imdbId: e.imdbId ?? null,
      });
    },
    [trakt, isNuvio],
  );

  useEffect(() => {
    if (!traktConnected) {
      setTrakt([]);
      setTraktStatus("idle");
      return;
    }
    let cancelled = false;
    setTraktStatus("loading");
    const loadTrakt = () => {
      if (cancelled || pendingRemovals.current > 0) return;
      const mySeq = guardSeq.current;
      fetchWatchlist()
        .then((items) => {
          if (cancelled) return;
          if (guardSeq.current !== mySeq) {
            loadTrakt();
            return;
          }
          setTrakt(items);
          setTraktStatus("ready");
        })
        .catch(() => {
          if (!cancelled) setTraktStatus("error");
        });
    };
    loadTrakt();
    return () => {
      cancelled = true;
    };
  }, [traktConnected, refreshSeq]);

  const merged = useMemo(
    () => mergeWatchlist(localEntries, stremio, trakt, isNuvio ? nuvioItems : undefined),
    [localEntries, stremio, trakt, isNuvio, nuvioItems],
  );

  const [type, setType] = useState<TypeKey>("all");
  const [query, setQuery] = useState("");
  const [flat, setFlat] = useState(() => localStorage.getItem("harbor.watchlist.flat") === "1");
  useEffect(() => {
    try {
      localStorage.setItem("harbor.watchlist.flat", flat ? "1" : "0");
    } catch {}
  }, [flat]);
  const toggleFlat = useCallback(() => {
    setFlat((v) => !v);
  }, []);
  const counts = useMemo(() => countByType(merged), [merged]);
  const visible = useMemo(() => applyFilter(merged, type, query), [merged, type, query]);
  const groups = useMemo(() => {
    if (settings.librarySort !== "recent") return sortedGroups(visible, settings.librarySort);
    if (flat)
      return [
        {
          label: "Everything",
          items: [...visible].sort((a, b) => (b.date ?? -Infinity) - (a.date ?? -Infinity)),
        },
      ];
    return groupByDate(visible);
  }, [visible, settings.librarySort, flat]);
  useReportFeatured(useMemo(() => visible.map((v) => v.meta), [visible]));

  const subtitle = (() => {
    const parts: string[] = [];
    if (traktConnected)
      parts.push(
        traktStatus === "loading" ? tr("Syncing Trakt…") : tr("{n} on Trakt", { n: trakt.length }),
      );
    else parts.push(tr("Connect Trakt in Settings to sync"));
    parts.push(tr("{n} saved on this device", { n: localEntries.length }));
    if (isNuvio && rawCount > 0) {
      parts.push(tr("{n} in your Nuvio library", { n: rawCount }));
    } else if (authKey && rawCount > 0) {
      parts.push(tr("{n} in your Stremio library", { n: rawCount }));
    }
    return parts.join(" · ");
  })();

  return (
    <section className="flex flex-col gap-4">
      {merged.length > 0 && (
        <FilterBar
          type={type}
          setType={setType}
          query={query}
          setQuery={setQuery}
          counts={counts}
          trailing={
            <>
              <SortControl />
              {settings.librarySort === "recent" && (
                <ViewModeToggle flat={flat} onToggle={toggleFlat} />
              )}
            </>
          }
        />
      )}
      <div className="flex items-center justify-between">
        <span className="text-[12px] text-ink-muted">{subtitle}</span>
      </div>
      {merged.length === 0 ? (
        <EmptyWatchlist connected={traktConnected} />
      ) : visible.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-edge-soft bg-canvas/30 px-6 py-10 text-center text-[13px] text-ink-muted">
          {tr("No matches for these filters.")}
        </p>
      ) : settings.librarySort !== "recent" ? (
        <GroupedGrid
          groups={groups}
          onRemove={handleRemove}
          onRemoveLocal={handleRemoveLocal}
          scrollRef={scrollRef}
        />
      ) : flat ? (
        <GroupedGrid
          groups={groups}
          onRemove={handleRemove}
          onRemoveLocal={handleRemoveLocal}
          scrollRef={scrollRef}
        />
      ) : (
        <GroupedGrid
          groups={groups}
          onRemove={handleRemove}
          onRemoveLocal={handleRemoveLocal}
          scrollRef={scrollRef}
        />
      )}
    </section>
  );
}

function ViewModeToggle({ flat, onToggle }: { flat: boolean; onToggle: () => void }) {
  const t = useT();
  return (
    <div className="flex items-center gap-1 rounded-full bg-elevated/40 p-0.5 ring-1 ring-edge-soft/60">
      <button
        onClick={() => flat && onToggle()}
        className={`rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold transition-colors ${
          !flat ? "bg-ink text-canvas" : "text-ink-muted hover:bg-raised hover:text-ink"
        }`}
      >
        {t("Grouped")}
      </button>
      <button
        onClick={() => !flat && onToggle()}
        className={`rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold transition-colors ${
          flat ? "bg-ink text-canvas" : "text-ink-muted hover:bg-raised hover:text-ink"
        }`}
      >
        {t("One list")}
      </button>
    </div>
  );
}

function traktTmdbForm(type: string, tmdb: number | undefined): string | null {
  return tmdb != null ? `tmdb:${type === "movie" ? "movie" : "tv"}:${tmdb}` : null;
}

function filmClosure(
  seed: Iterable<string>,
  locals: LocalEntry[],
  traktItems: TraktItem[],
): Set<string> {
  const closure = new Set(seed);
  for (let pass = 0; pass < 3; pass++) {
    let grew = false;
    const take = (v: string | null | undefined) => {
      if (v && !closure.has(v)) {
        closure.add(v);
        grew = true;
      }
    };
    for (const l of locals) {
      if (closure.has(l.id) || (l.imdbId != null && closure.has(l.imdbId))) {
        take(l.id);
        take(l.imdbId);
      }
    }
    for (const t of traktItems) {
      const tk = traktTmdbForm(t.type, t.ids.tmdb);
      if ((t.ids.imdb && closure.has(t.ids.imdb)) || (tk && closure.has(tk))) {
        take(t.ids.imdb ?? null);
        take(tk);
      }
    }
    if (!grew) break;
  }
  return closure;
}

export function filterLibrary(
  items: LibraryItem[],
  bookmarkedOnly: boolean,
  mode: "library" | "watchlist",
): LibraryItem[] {
  return items.filter((i) => {
    if (i.removed) return false;
    // Watchlist contains explicit bookmarks; temporary browse/history entries
    // can still appear in Library when its bookmarked-only filter is disabled.
    if ((bookmarkedOnly || mode === "watchlist") && i.temp) return false;
    if (mode === "library") return true;
    if ((i.state?.flaggedWatched ?? 0) > 0 || (i.state?.timesWatched ?? 0) > 0) return false;
    if ((i.state?.timeOffset ?? 0) > 0) return false;
    return true;
  });
}

export function mergeWatchlist(
  localEntries: LocalEntry[],
  stremio: LibraryItem[],
  trakt: TraktItem[],
  nuvioItems?: NuvioLibraryItem[],
): WatchlistMerged[] {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "")
      .trim();
  const byKey = new Map<string, WatchlistMerged>();
  const seenIds = new Set<string>();
  // Year is only known for Trakt items (item.year). Local entries and Stremio
  // library items carry no year, so they get a per-entry unique key and are
  // never collapsed into another card by name alone.
  const dedupKey = (type: string, name: string, year: string | null, id: string) =>
    `${type}:${norm(name)}:${year ?? `unknown:${id}`}`;
  const setOrUpgrade = (key: string, entry: WatchlistMerged, year: string | null): boolean => {
    if (seenIds.has(entry.meta.id)) return false;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, entry);
      seenIds.add(entry.meta.id);
      return true;
    }
    // Same type+name+year: prefer the IMDb (tt) id, but only when the year
    // matches — a tt id must never evict a different-year title.
    const existingTt = existing.meta.id.startsWith("tt");
    const incomingTt = entry.meta.id.startsWith("tt");
    if (year !== null && incomingTt && !existingTt) {
      byKey.set(key, entry);
      seenIds.add(entry.meta.id);
      return true;
    }
    return false;
  };
  // Identity index: every placed id/imdbId -> its card slot, so the same film
  // kept as tt… in one source and tmdb:… in another lands on one card.
  const filmSlot = new Map<string, string>();
  const identityKeys = (id: string, imdb: string | null): string[] => {
    const keys = [id];
    if (imdb && imdb.startsWith("tt") && imdb !== id) keys.push(imdb);
    return keys;
  };
  const place = (
    entry: WatchlistMerged,
    year: string | null,
    imdb: string | null,
    typeForKey: string,
    nameForKey: string,
  ) => {
    const keys = identityKeys(entry.meta.id, imdb);
    const slots = new Set(
      keys.map((key) => filmSlot.get(key)).filter((slot) => slot !== undefined),
    );
    const slot = slots.values().next().value;
    if (slot !== undefined) {
      let merged = entry;
      for (const matchedSlot of slots) {
        const existing = byKey.get(matchedSlot);
        if (!existing) continue;
        const kept = !existing.stremioId && merged.stremioId ? merged : existing;
        const dropped = kept === existing ? merged : existing;
        merged = { ...kept, key: existing.key, localId: kept.localId ?? dropped.localId };
        byKey.delete(matchedSlot);
      }
      byKey.set(slot, merged);
      // A newly learned IMDb/TMDB pair can connect two cards already placed.
      // Redirect every alias of both cards to the single retained slot.
      if (slots.size > 1) {
        for (const [id, previousSlot] of filmSlot) {
          if (slots.has(previousSlot)) filmSlot.set(id, slot);
        }
      }
      seenIds.add(entry.meta.id);
      for (const key of keys) filmSlot.set(key, slot);
      return;
    }
    const key = dedupKey(typeForKey, nameForKey, year, entry.meta.id);
    if (setOrUpgrade(key, entry, year)) {
      for (const k of identityKeys(entry.meta.id, imdb)) filmSlot.set(k, key);
    } else {
      filmSlot.set(entry.meta.id, key);
    }
  };
  for (const item of stremio) {
    const meta: Meta = {
      id: item._id,
      type: libraryMetaType(item.type),
      name: item.name,
      poster: item.poster,
      background: item.background,
    };
    place(
      {
        key: item._id,
        meta,
        date: parseTs(item._mtime),
        stremioId: item._id,
      },
      null,
      null,
      item.type,
      item.name ?? "",
    );
  }
  if (nuvioItems && nuvioItems.length > 0) {
    for (const item of nuvioItems) {
      const meta: Meta = {
        id: item.content_id,
        type: libraryMetaType(item.content_type),
        name: item.name,
        poster: item.poster || undefined,
        background: item.background || undefined,
        logo: item.logo || undefined,
        description: item.description || undefined,
        releaseInfo: item.release_info || undefined,
        imdbRating: item.imdb_rating ? String(item.imdb_rating) : undefined,
        genres: item.genres || [],
      };
      place(
        {
          key: item.content_id,
          meta,
          date: item.added_at,
          stremioId: item.content_id,
        },
        item.release_info || null,
        item.content_id.startsWith("tt") ? item.content_id : null,
        item.content_type,
        item.name ?? "",
      );
    }
  }
  for (const t of trakt) {
    const m = traktItemToMeta(t);
    if (!m) continue;
    const year = t.year ? String(t.year) : null;
    place(
      { key: m.id, meta: m, date: parseTs(t.contextDate) },
      year,
      t.ids.imdb ?? null,
      m.type,
      m.name ?? "",
    );
  }
  if (nuvioItems !== undefined) {
    const nuvioIdSet = new Set(nuvioItems.map((i) => i.content_id));
    for (const e of localEntries) {
      if (nuvioIdSet.has(e.id) || (e.imdbId && nuvioIdSet.has(e.imdbId))) {
        place(
          {
            key: e.id,
            meta: {
              id: e.id,
              type: e.type,
              name: e.name || e.id,
              poster: e.poster,
              addonOrigin: e.addonOrigin,
              videos: e.videos,
            },
            date: e.addedAt || null,
            localId: e.id,
          },
          null,
          e.imdbId ?? null,
          e.type,
          e.name,
        );
      }
    }
  } else {
    for (const e of localEntries) {
      place(
        {
          key: e.id,
          meta: {
            id: e.id,
            type: e.type,
            name: e.name || e.id,
            poster: e.poster,
            addonOrigin: e.addonOrigin,
            videos: e.videos,
          },
          date: e.addedAt || null,
          localId: e.id,
        },
        null,
        e.imdbId ?? null,
        e.type,
        e.name,
      );
    }
  }
  return Array.from(byKey.values());
}
