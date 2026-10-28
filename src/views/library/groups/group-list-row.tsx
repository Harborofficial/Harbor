import { useEffect, useRef, useState } from "react";
import { PickCard } from "@/components/pick-card";
import { Row } from "@/components/row";
import { useT } from "@/lib/i18n";
import { useSettings } from "@/lib/settings";
import type { GroupList } from "@/lib/library-groups";
import type { MdblistPage } from "@/lib/providers/mdblist-lists";
import { fetchGroupListPage } from "@/lib/providers/group-list-page";
import { useTrakt } from "@/lib/trakt/provider";
import { groupButtonClass } from "./group-editor";

export function GroupListRow({
  list,
  refresh,
  expanded,
  onExpand,
  onBack,
}: {
  list: GroupList;
  refresh: number;
  expanded: boolean;
  onExpand: () => void;
  onBack: () => void;
}) {
  const t = useT();
  const { settings } = useSettings();
  const { session } = useTrakt();
  const [page, setPage] = useState<MdblistPage>({ items: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const generation = useRef(0);
  useEffect(() => {
    const current = ++generation.current;
    setLoading(true);
    setError("");
    setPage({ items: [] });
    void fetchGroupListPage(settings.mdblistKey, list.url, undefined, refresh > 0)
      .then((result) => {
        if (current === generation.current) setPage(result);
      })
      .catch((reason: unknown) => {
        if (current === generation.current)
          setError(reason instanceof Error ? reason.message : "Could not load this list.");
      })
      .finally(() => {
        if (current === generation.current) setLoading(false);
      });
    return () => {
      generation.current++;
    };
  }, [settings.mdblistKey, list.url, refresh, session]);
  const loadMore = async () => {
    if (!page.cursor || loading) return;
    const current = generation.current;
    setLoading(true);
    setError("");
    try {
      const next = await fetchGroupListPage(settings.mdblistKey, list.url, page.cursor);
      if (generation.current !== current) return;
      setPage((previous) => {
        const seen = new Set(previous.items.map((item) => `${item.type}:${item.id}`));
        return {
          items: [
            ...previous.items,
            ...next.items.filter((item) => !seen.has(`${item.type}:${item.id}`)),
          ],
          cursor: next.cursor === previous.cursor ? undefined : next.cursor,
        };
      });
    } catch (reason) {
      if (generation.current === current)
        setError(reason instanceof Error ? reason.message : t("Could not load this list."));
    } finally {
      if (generation.current === current) setLoading(false);
    }
  };
  return (
    <section className="flex flex-col gap-3">
      {expanded && (
        <button type="button" className={`${groupButtonClass} self-start`} onClick={onBack}>
          {t("Back to group")}
        </button>
      )}
      {expanded ? (
        <>
          <h2 className="text-xl font-semibold text-ink">{list.name}</h2>
          <div
            className="grid gap-5"
            style={{ gridTemplateColumns: "repeat(auto-fill,minmax(150px,1fr))" }}
          >
            {page.items.map((meta) => (
              <PickCard key={`${meta.type}:${meta.id}`} meta={meta} />
            ))}
          </div>
        </>
      ) : (
        <Row title={list.name} onViewAll={onExpand}>
          {page.items.slice(0, 20).map((meta) => (
            <PickCard key={`${meta.type}:${meta.id}`} meta={meta} />
          ))}
        </Row>
      )}
      {loading && (
        <p role="status" className="text-sm text-ink-muted">
          {t("Loading…")}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-400">
          {t(error)}
        </p>
      )}
      {!loading && !error && page.items.length === 0 && (
        <p className="text-sm text-ink-muted">{t("This list is empty.")}</p>
      )}
      {expanded && page.cursor && (
        <button
          type="button"
          className={`${groupButtonClass} self-start`}
          disabled={loading}
          onClick={() => void loadMore()}
        >
          {t("Load more")}
        </button>
      )}
    </section>
  );
}
