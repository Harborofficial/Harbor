import { Check, Plus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import publicmetadbLogo from "@/assets/publicmetadb.svg";
import { HoverTooltip } from "@/components/hover-tooltip";
import { getTmdbForExternal } from "@/lib/publicmetadb/mappings";
import { usePublicMetaDb } from "@/lib/publicmetadb/provider";
import type { PmdbSession, PmdbTarget } from "@/lib/publicmetadb/types";
import {
  capturePmdbListOwner,
  getPmdbDefaultListId,
  pmdbListErrorMessage,
  resolvePmdbList,
} from "@/lib/publicmetadb/lists";
import { usePmdbListsVersion } from "@/lib/publicmetadb/list-hooks";
import {
  addToPmdbWatchlist,
  fetchPmdbWatchlist,
  pmdbWatchlistContains,
  removeFromPmdbWatchlist,
} from "@/lib/publicmetadb/watchlist";
import { useT } from "@/lib/i18n";

type WatchlistScope = {
  harborId: string;
  type: "movie" | "series";
  listId: string | null;
  session: PmdbSession | null;
};

function sameScope(previous: WatchlistScope | undefined, current: WatchlistScope): boolean {
  return previous?.harborId === current.harborId && previous.type === current.type &&
    previous.listId === current.listId && previous.session === current.session;
}

export function usePmdbWatchlist(harborId: string, type: "movie" | "series") {
  const { isConnected, session, resolveTargetAsync } = usePublicMetaDb();
  const version = usePmdbListsVersion();
  const listId = getPmdbDefaultListId();
  const [listName, setListName] = useState("Watchlist");
  const [target, setTarget] = useState<PmdbTarget | null>(null);
  const [inList, setInList] = useState(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);
  const current = useRef<WatchlistScope>({ harborId, type, listId, session });
  const loaded = useRef<{ scope: WatchlistScope; target: PmdbTarget } | null>(null);
  current.current = { harborId, type, listId, session };

  useEffect(() => {
    if (!isConnected) {
      loaded.current = null;
      setTarget(null);
      setInList(false);
      setReady(false);
      return;
    }
    let cancelled = false;
    const guard = capturePmdbListOwner();
    const scope = { harborId, type, listId, session };
    const previous = loaded.current;
    const refresh = sameScope(previous?.scope, scope);
    if (!refresh) {
      setReady(false);
      setTarget(null);
      setInList(false);
    }
    setError(null);
    void (async () => {
      // Add-to-list takes tmdb_id + media_type only: ID-only targets must
      // resolve through mappings first, otherwise hide instead of erroring.
      let tgt = refresh && previous
        ? previous.target
        : await resolveTargetAsync(harborId, undefined, type).catch(() => null);
      if (!cancelled && tgt && tgt.tmdb_id == null && tgt.id_type && tgt.id_value) {
        const found = await getTmdbForExternal(tgt.id_type, tgt.id_value).catch(() => null);
        tgt = found ? { ...tgt, tmdb_id: found.tmdb_id } : null;
      }
      if (cancelled) return;
      if (!tgt || tgt.tmdb_id == null) {
        loaded.current = null;
        setTarget(null);
        setReady(true);
        return;
      }
      setTarget(tgt);
      try {
        const list = await resolvePmdbList({ listId, assertCurrent: guard });
        const items = await fetchPmdbWatchlist({ listId, strict: true, assertCurrent: guard });
        if (cancelled) return;
        setListName(list?.name || "Watchlist");
        if (!running.current) setInList(pmdbWatchlistContains(items, tgt) != null);
      } catch (error) {
        if (!cancelled) setError(pmdbListErrorMessage(error));
      } finally {
        if (!cancelled) {
          loaded.current = { scope, target: tgt };
          setReady(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [harborId, isConnected, session, listId, version, resolveTargetAsync, type]);

  const toggle = useCallback(async () => {
    if (!target || running.current || !sameScope(loaded.current?.scope, current.current)) return false;
    running.current = true;
    const owner = capturePmdbListOwner();
    const identity = current.current;
    const isCurrent = () => sameScope(identity, current.current);
    setBusy(true);
    setError(null);
    const prev = inList;
    setInList(!prev);
    try {
      const ok = prev
        ? await removeFromPmdbWatchlist(target, { listId, strict: true, assertCurrent: owner })
        : await addToPmdbWatchlist(target, { listId, strict: true, assertCurrent: owner });
      if (!ok) {
        if (isCurrent()) setInList(prev);
        return false;
      }
      return true;
    } catch (error) {
      if (isCurrent()) {
        setInList(prev);
        setError(pmdbListErrorMessage(error));
      }
      return false;
    } finally {
      running.current = false;
      setBusy(false);
    }
  }, [target, inList, listId]);

  return {
    isConnected, target, inList,
    ready: ready && sameScope(loaded.current?.scope, current.current),
    busy, error, toggle, listName,
  };
}

export function AddToPmdbButton({
  harborId,
  title,
  type,
}: {
  harborId: string;
  title: string;
  type: "movie" | "series";
}) {
  const t = useT();
  const { isConnected, target, inList, ready, busy, error, toggle, listName } = usePmdbWatchlist(
    harborId,
    type,
  );

  if (!isConnected || !target || !ready) return null;

  return (
    <div className="relative shrink-0">
      <HoverTooltip
        label={inList
          ? t("Remove {title} from {list} on PMDB", { title, list: listName })
          : t("Add {title} to {list} on PMDB", { title, list: listName })}
        align="center"
      >
        <button
          type="button"
          disabled={busy}
          onClick={() => void toggle()}
          className={`flex h-12 items-center gap-2.5 rounded-full px-6 text-[15px] font-medium transition-[transform,background-color,border-color] duration-200 active:scale-[0.98] disabled:opacity-60 ${
            inList
              ? "border border-ink bg-ink/10 text-ink hover:bg-ink/20"
              : "bg-canvas/80 text-ink hover:bg-canvas/95"
          }`}
        >
          <img src={publicmetadbLogo} alt="" className="h-[18px] w-[18px] rounded-[4px] object-contain" />
          {inList ? (
            <Check size={16} strokeWidth={2.2} className="-ms-1" />
          ) : (
            <Plus size={16} strokeWidth={2.2} className="-ms-1" />
          )}
          {inList ? t("In PMDB") : t("Add to PMDB")}
        </button>
      </HoverTooltip>
      {error && (
        <div className="absolute start-0 top-full z-40 mt-1.5 whitespace-nowrap rounded-lg bg-danger px-2.5 py-1 text-[11.5px] font-semibold text-white shadow-[0_8px_24px_rgba(0,0,0,0.5)]">
          {t(error)}
        </div>
      )}
    </div>
  );
}
