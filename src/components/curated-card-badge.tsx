import { cardBadge } from "@/lib/curated/registry";
import type { CuratedList, CuratedListItem } from "@/lib/curated/types";
import type { RowShape } from "./row";

export function CuratedCardBadge({
  list,
  item,
  shape,
}: {
  list: CuratedList;
  item: CuratedListItem;
  shape: RowShape;
}) {
  const label = cardBadge(list, item);
  if (!label) return null;
  const badgeClass =
    shape === "landscape"
      ? "absolute start-1.5 top-0.5 font-display text-[30px] font-semibold leading-none text-white/95 [text-shadow:0_1px_2px_rgba(0,0,0,0.9),_0_2px_8px_rgba(0,0,0,0.6)]"
      : "absolute bottom-1.5 start-1.5 grid h-[19px] min-w-[19px] place-items-center rounded-md bg-canvas/95 px-1.5 text-[11px] font-semibold tabular-nums leading-none text-ink";
  return (
    <span className="pointer-events-none absolute inset-x-0 top-0 aspect-[2/3]">
      <span className={badgeClass}>{label}</span>
    </span>
  );
}
