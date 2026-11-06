import { RefreshCcw } from "lucide-react";
import { useT } from "@/lib/i18n";
import { ClapperMini } from "@/components/icons/clapper-mini";
import type { BadgeTone } from "@/lib/card-badges";

export type CardLayout = "poster" | "tv";

const BADGE_STACKS: Record<CardLayout, { plain: string[]; ribbon: string[]; circles: string[] }> = {
  poster: {
    plain: ["top-2", "top-[34px]", "top-[54px]", "top-[74px]", "top-[94px]", "top-[114px]"],
    ribbon: ["top-[34px]", "top-[54px]", "top-[74px]", "top-[94px]", "top-[114px]", "top-[134px]"],
    circles: ["top-1.5", "top-[34px]", "top-[62px]", "top-[90px]", "top-[118px]", "top-[146px]"],
  },
  tv: {
    plain: ["top-2", "top-[34px]", "top-[54px]", "top-[74px]", "top-[94px]", "top-[114px]"],
    ribbon: ["top-[48px]", "top-[76px]", "top-[104px]", "top-[132px]", "top-[160px]", "top-[188px]"],
    circles: ["top-1.5", "top-[48px]", "top-[76px]", "top-[104px]", "top-[132px]", "top-[160px]"],
  },
};

export function stackTop(
  slots: number,
  ribbon: boolean,
  layout: CardLayout = "poster",
  circle = false,
): string {
  const values = BADGE_STACKS[layout][circle ? "circles" : ribbon ? "ribbon" : "plain"];
  return values[Math.min(Math.max(0, slots), values.length - 1)];
}

export function StatusBadge({
  label,
  tone = "default",
  kids = false,
  dubShift = false,
  ribbonShift = false,
  side = "start",
  layout = "poster",
}: {
  label: string;
  tone?: BadgeTone;
  kids?: boolean;
  dubShift?: boolean;
  ribbonShift?: boolean;
  side?: "start" | "end";
  layout?: CardLayout;
}) {
  const styles = kids
    ? "bg-black text-white"
    : tone === "accent"
      ? "bg-accent/90 text-canvas"
      : "border border-edge-soft bg-canvas/95 text-ink";
  return (
    <span
      className={`absolute ${side === "end" ? "end-2" : "start-2"} ${stackTop(dubShift ? 1 : 0, ribbonShift, layout)} rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${styles}`}
    >
      {label}
    </span>
  );
}

export function CinemaBadge({ dubShift = false, ribbonShift = false, side = "start", layout = "poster" }: { dubShift?: boolean; ribbonShift?: boolean; side?: "start" | "end"; layout?: CardLayout; className?: string }) {
  const t = useT();
  return (
    <span
      className={`harbor-cinema-badge absolute ${side === "end" ? "end-2" : "start-2"} ${stackTop(dubShift ? 1 : 0, ribbonShift, layout)} flex items-center gap-1 rounded-md bg-canvas/95 px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-[0.14em]`}
    >
      <ClapperMini size={10} />
      <span>{t("In Cinema")}</span>
    </span>
  );
}

export function RerunBadge({
  year,
  dubShift = false,
  ribbonShift = false,
  side = "start",
  layout = "poster",
}: {
  year?: string;
  dubShift?: boolean;
  ribbonShift?: boolean;
  side?: "start" | "end";
  layout?: CardLayout;
}) {
  const t = useT();
  return (
    <span
      className={`absolute ${side === "end" ? "end-2" : "start-2"} ${stackTop(dubShift ? 1 : 0, ribbonShift, layout)} flex items-center gap-1 rounded-md border border-edge-soft bg-canvas/95 px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-[0.14em] text-ink-muted`}
    >
      <RefreshCcw size={9} strokeWidth={2.4} />
      <span>
        {t("Rerun")}
        {year ? ` · ${year}` : ""}
      </span>
    </span>
  );
}

export function KidsStarBadge({
  value,
  placement = "bottom",
}: {
  value: string;
  placement?: "top" | "bottom";
}) {
  return (
    <span
      className={`pointer-events-none absolute end-1 grid h-9 w-9 place-items-center ${
        placement === "top" ? "top-1" : "bottom-1"
      }`}
    >
      <img
        src="/kids/starbadge.svg"
        alt=""
        draggable={false}
        className="absolute inset-0 h-full w-full object-contain drop-shadow-[0_2px_6px_rgba(0,0,0,0.3)]"
      />
      <span className="relative translate-y-[1px] text-[9px] font-extrabold leading-none text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.6)]">
        {value}
      </span>
    </span>
  );
}
