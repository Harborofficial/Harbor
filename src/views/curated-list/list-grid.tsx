import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { CuratedCardBadge } from "@/components/curated-card-badge";
import { PickCard } from "@/components/pick-card";
import type { RowShape } from "@/components/row";
import { useT } from "@/lib/i18n";
import { cardBadge, itemMeta } from "@/lib/curated/registry";
import { useSettings } from "@/lib/settings";
import type { CuratedList, CuratedListItem, ListOrdering } from "@/lib/curated/types";

type ListSort = "order" | "title" | "newest" | "oldest";

const PAGE = 60;

const ORDER_LABEL: Record<ListOrdering, string> = {
  ranked: "Ranked",
  spine: "Spine order",
  awarded: "By year",
  unordered: "As listed",
};

function sortItems(items: readonly CuratedListItem[], sort: ListSort): readonly CuratedListItem[] {
  if (sort === "order") return items;
  const out = [...items];
  if (sort === "title") {
    out.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));
    return out;
  }
  const dir = sort === "newest" ? -1 : 1;
  out.sort((a, b) => ((a.year ?? 0) - (b.year ?? 0)) * dir);
  return out;
}

export function ListGrid({
  list,
  items,
  scrollRoot,
  sizing,
}: {
  list: CuratedList;
  items: readonly CuratedListItem[];
  scrollRoot: RefObject<HTMLElement | null>;
  sizing: { min: number; shape: RowShape };
}) {
  const t = useT();
  const { settings } = useSettings();
  const minCardWidth = Math.max(72, Math.round(sizing.min * settings.posterScale));
  const [sort, setSort] = useState<ListSort>("order");
  const [shown, setShown] = useState(PAGE);
  const sentinel = useRef<HTMLDivElement>(null);
  const sorted = useMemo(() => sortItems(items, sort), [items, sort]);

  useEffect(() => {
    setShown(PAGE);
  }, [sort, items]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || shown >= sorted.length) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) setShown((n) => n + PAGE);
      },
      { root: scrollRoot.current, rootMargin: "900px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [shown, sorted.length, scrollRoot]);

  const visible = sorted.slice(0, shown);

  return (
    <section className="flex flex-col gap-7">
      <SortBar sort={sort} onSort={setSort} orderLabel={ORDER_LABEL[list.ordering]} />
      <div
        className="grid gap-x-5 gap-y-8"
        style={{
          gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, ${minCardWidth}px), 1fr))`,
        }}
      >
        {visible.map((item) => (
          <span key={item.imdb} className="relative block min-w-0">
            <PickCard
              meta={itemMeta(list, item)}
              curatedBadgeAtTopStart={sizing.shape === "landscape" && cardBadge(list, item) != null}
            />
            <CuratedCardBadge list={list} item={item} shape={sizing.shape} />
          </span>
        ))}
      </div>
      {shown < sorted.length && <div ref={sentinel} className="h-24" />}
      {sorted.length === 0 && (
        <p className="py-20 text-center text-[14px] text-ink-subtle">{t("Nothing here yet.")}</p>
      )}
    </section>
  );
}

function SortBar({
  sort,
  onSort,
  orderLabel,
}: {
  sort: ListSort;
  onSort: (s: ListSort) => void;
  orderLabel: string;
}) {
  const t = useT();
  const options: Array<[ListSort, string]> = [
    ["order", orderLabel],
    ["title", "A-Z"],
    ["newest", "Newest"],
    ["oldest", "Oldest"],
  ];
  return (
    <div className="flex w-fit items-center gap-1 self-start rounded-full bg-elevated/40 p-0.5 ring-1 ring-edge-soft/60">
      {options.map(([key, label]) => (
        <button
          key={key}
          type="button"
          onClick={() => onSort(key)}
          aria-pressed={sort === key}
          className={`rounded-full px-3 py-1.5 text-[12px] font-semibold transition-colors focus:outline-none focus:ring-1 focus:ring-inset focus:ring-ink-subtle ${
            sort === key ? "bg-ink text-canvas" : "text-ink-muted hover:bg-raised hover:text-ink"
          }`}
        >
          {t(label)}
        </button>
      ))}
    </div>
  );
}
