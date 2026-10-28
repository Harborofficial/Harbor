import { useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Dropdown } from "@/components/dropdown";
import { pmdbWatchlistItemToMeta, removeFromPmdbWatchlist } from "@/lib/publicmetadb/watchlist";
import type { PmdbList, PmdbListItem } from "@/lib/publicmetadb/types";
import {
  capturePmdbListOwner,
  fetchPmdbLists,
  fetchPmdbListItems,
  getPmdbDefaultListId,
  notifyPmdbListsChanged,
  pmdbListErrorMessage,
  PmdbListError,
  setPmdbDefaultListId,
} from "@/lib/publicmetadb/lists";
import { usePmdbListsVersion } from "@/lib/publicmetadb/list-hooks";
import { usePublicMetaDb } from "@/lib/publicmetadb/provider";
import { getSession } from "@/lib/publicmetadb/session";
import { useSettings } from "@/lib/settings";
import { useT } from "@/lib/i18n";
import {
  applyFilter,
  countByType,
  FilterBar,
  GroupedGrid,
  parseTs,
  SortControl,
  sortedGroups,
  type TypeKey,
  type WatchlistMerged,
} from "./shared";
import { useReportFeatured } from "./featured-context";

export function PublicMetaDbTab() {
  const tr = useT();
  const { settings } = useSettings();
  const { session } = usePublicMetaDb();
  const version = usePmdbListsVersion();
  const defaultId = getPmdbDefaultListId();
  const [lists, setLists] = useState<PmdbList[]>([]);
  const [catalogReady, setCatalogReady] = useState(false);
  const [selection, setSelection] = useState<{ session: typeof session; id: string | null } | null>(null);
  const selectedId = selection?.session === session ? selection.id : defaultId;
  const selectedList = selectedId
    ? lists.find((list) => list.id === selectedId)
    : lists.find((list) => list.type === "watchlist");
  const isDefault = selectedId === defaultId || (!defaultId && selectedList?.type === "watchlist");
  const defaultMissing = catalogReady && !!defaultId && !lists.some((list) => list.id === defaultId);
  const [items, setItems] = useState<PmdbListItem[]>([]);
  const [owner, setOwner] = useState(session);
  const [loadedListId, setLoadedListId] = useState<string | null>();
  const contentCurrent = owner === session && loadedListId === (selectedId || selectedList?.id || null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    const guard = capturePmdbListOwner();
    setStatus("loading");
    setItems([]);
    setLists([]);
    setCatalogReady(false);
    setError(null);
    void (async () => {
      try {
        const next = await fetchPmdbLists({ assertCurrent: guard });
        if (cancelled) return;
        setLists(next);
        setCatalogReady(true);
        const list = selectedId ? next.find((list) => list.id === selectedId) : next.find((list) => list.type === "watchlist");
        if (selectedId && !list) throw new PmdbListError("missing");
        const entries = list ? await fetchPmdbListItems(list.id, guard) : [];
        if (cancelled) return;
        setOwner(session);
        setLoadedListId(list?.id ?? null);
        setItems(entries);
        setStatus("ready");
      } catch (error) {
        if (!cancelled) {
          setOwner(session);
          setError(pmdbListErrorMessage(error));
          setStatus("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedId, session, version]);

  const entries = useMemo<WatchlistMerged[]>(
    () =>
      (contentCurrent ? items : [])
        .map((item): WatchlistMerged | null => {
          const meta = pmdbWatchlistItemToMeta(item);
          if (!meta) return null;
          return { key: `pmdb-${item.id}`, meta, date: parseTs(item.created), localId: item.id };
        })
        .filter((x): x is WatchlistMerged => !!x),
    [items, contentCurrent],
  );

  const [type, setType] = useState<TypeKey>("all");
  const [query, setQuery] = useState("");
  const counts = useMemo(() => countByType(entries), [entries]);
  const visible = useMemo(() => applyFilter(entries, type, query), [entries, type, query]);
  useReportFeatured(useMemo(() => visible.map((v) => v.meta), [visible]));

  const removeItem = async (itemId: string) => {
    const item = items.find((item) => item.id === itemId);
    if (!item || !selectedList || !contentCurrent) return;
    const guard = capturePmdbListOwner(() => {
      if (getSession() !== session) throw new DOMException("Account changed", "AbortError");
    });
    try {
      await removeFromPmdbWatchlist(
        { tmdb_id: item.tmdb_id, media_type: item.media_type },
        { listId: selectedList.id, strict: true, assertCurrent: guard },
      );
    } catch (error) {
      if (getSession() === session) setError(pmdbListErrorMessage(error));
    }
  };

  const options = lists.map((list) => ({
    value: list.type === "watchlist" ? "" : list.id,
    label: `${list.name || tr("Watchlist")}${(defaultId === list.id || (!defaultId && list.type === "watchlist")) ? ` · ${tr("Default")}` : ""}`,
  }));
  if (!lists.some((list) => list.type === "watchlist"))
    options.unshift({ value: "", label: `${tr("Watchlist")}${!defaultId ? ` · ${tr("Default")}` : ""}` });
  if (selectedId && !lists.some((list) => list.id === selectedId))
    options.push({ value: selectedId, label: tr("Unavailable list") });

  return (
    <section className="flex flex-col gap-10">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-[18px] font-semibold text-ink">PublicMetaDB</h2>
          <Dropdown
            value={selectedList?.type === "watchlist" ? "" : selectedId ?? ""}
            options={options}
            ariaLabel={tr("PublicMetaDB list")}
            onChange={(id) => { setSelection({ session, id: id || null }); setQuery(""); }}
          />
          <button
            type="button"
            disabled={status === "loading" || owner !== session || isDefault || (!!selectedId && !selectedList)}
            onClick={() => {
              try {
                if (getSession() !== session) {
                  setError("PublicMetaDB account changed. Try again.");
                  return;
                }
                setPmdbDefaultListId(selectedList?.type === "watchlist" ? null : selectedId);
              }
              catch { setError("Couldn't save your default PublicMetaDB list."); }
            }}
            className="min-h-11 rounded-lg px-3 text-[13px] text-ink hover:bg-raised disabled:opacity-50"
          >
            {isDefault ? tr("Default list") : tr("Set as default")}
          </button>
          <button
            type="button"
            aria-label={tr("Refresh PublicMetaDB lists")}
            disabled={status === "loading"}
            onClick={notifyPmdbListsChanged}
            className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-ink hover:bg-raised disabled:opacity-50"
          >
            <RefreshCw size={16} />
          </button>
          <span className="text-[12px] text-ink-muted">
            {tr("{shown} of {total}", { shown: visible.length, total: entries.length })}
          </span>
        </div>
        {defaultMissing && status !== "loading" && (
          <p className="text-[13px] text-danger">
            {tr("Your default PublicMetaDB list is unavailable. Select a list and set it as default.")}
          </p>
        )}
        <p className="text-[12px] text-ink-muted">
          {tr('"Add to PMDB" saves to your default list. Browsing another list does not change it.')}
        </p>
        {entries.length > 0 && (
          <FilterBar
            type={type}
            setType={setType}
            query={query}
            setQuery={setQuery}
            counts={counts}
            trailing={<SortControl />}
          />
        )}
        {status === "loading" || owner !== session || (status === "ready" && !contentCurrent) ? (
          <p className="text-[13px] text-ink-muted">{tr("Loading…")}</p>
        ) : status === "error" ? null : visible.length === 0 ? (
          <p className="text-[13px] text-ink-muted">
            {entries.length === 0
              ? !selectedList
                ? tr('Your first "Add to PMDB" will create a private watchlist.')
                : tr("This PublicMetaDB list is empty.")
              : tr("No matches for these filters.")}
          </p>
        ) : (
          <GroupedGrid
            groups={sortedGroups(visible, settings.librarySort)}
            onRemoveLocal={(id) => void removeItem(id)}
            removeLabel={tr("Remove from {list} on PMDB", { list: selectedList?.name || tr("Watchlist") })}
          />
        )}
      </div>
      {error && (
        <p className="rounded-lg bg-danger/15 px-3 py-2 text-[12px] text-danger ring-1 ring-danger/30">
          {tr(error)}
        </p>
      )}
    </section>
  );
}
