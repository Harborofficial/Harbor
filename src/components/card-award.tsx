import { useMemo } from "react";
import { AwardTab } from "./award-tab";
import { AwardLogo } from "./icons/award-logo";
import { awardSummary, useAwards } from "@/lib/providers/wikidata";
import { mergeBundledAwards } from "@/lib/awards-history";
import {
  awardSourceMeta,
  findAnyAwardWins,
  findTopAward,
  parseAwardYear,
} from "@/lib/anime-awards";
import type { AwardWin } from "@/lib/anime-awards";
import type { Meta } from "@/lib/cinemeta";
import { shortCategory } from "@/lib/anime-award-labels";
import { useAwardIcon } from "@/lib/award-icons";
import { useT } from "@/lib/i18n";
import { stackTop, type CardLayout } from "./card-status-badges";

const NOUN: Record<string, string> = {
  oscar: "Oscar",
  emmy: "Emmy",
  golden_globe: "Globe",
  bafta: "BAFTA",
  bafta_tv: "BAFTA",
  sag: "SAG",
  critics_choice: "Critics",
  cannes: "Cannes",
  venice: "Venice",
  berlin: "Berlin",
  annie: "Annie",
  spirit: "Spirit",
  saturn: "Saturn",
  cesar: "Cesar",
  goya: "Goya",
  blue_dragon: "Blue Dragon",
  baeksang: "Baeksang",
  bifa: "BIFA",
};

export type ClassicWin = { type: string; wins: number };

function labelFor(win: ClassicWin): string {
  const noun = NOUN[win.type] ?? "Award";
  if (win.wins > 1) return `${win.wins} ${noun.endsWith("s") ? noun : `${noun}s`}`;
  return noun;
}

export function useClassicAwardWin(meta: Meta, imdbId?: string): ClassicWin | null {
  const live = useAwards(imdbId, meta.type === "series");
  const year = parseAwardYear(meta.releaseInfo);
  return useMemo(() => {
    const summary = awardSummary(mergeBundledAwards(live, meta.name, year));
    const won = summary.find((s) => s.wins > 0);
    return won ? { type: won.type, wins: won.wins } : null;
  }, [live, meta.name, year]);
}

export function ClassicAwardTab({
  win,
  below,
  top,
  topClass: topClassOverride,
}: {
  win: ClassicWin | null;
  below?: boolean;
  top?: boolean;
  topClass?: string;
}) {
  if (!win) return null;
  return (
    <span
      className={`pointer-events-none absolute left-1/2 z-10 -translate-x-1/2 ${
        topClassOverride ?? (top ? "top-1.5" : below ? "bottom-1.5" : "bottom-7")
      }`}
    >
      <AwardTab label={labelFor(win)} />
    </span>
  );
}

export function ClassicAwardBadge({
  win,
  stacked = false,
  dubShift = false,
  ribbonShift = false,
  layout = "poster",
  topClass: topClassOverride,
  side = "start",
}: {
  win: ClassicWin | null;
  stacked?: boolean;
  dubShift?: boolean;
  ribbonShift?: boolean;
  layout?: CardLayout;
  topClass?: string;
  side?: "start" | "end";
}) {
  if (!win) return null;
  const above = (dubShift ? 1 : 0) + (stacked ? 1 : 0);
  const topClass = topClassOverride ?? stackTop(above, ribbonShift, layout);
  const horizontalClass = side === "end" ? "end-2" : "start-2";
  return (
    <span
      className={`pointer-events-none absolute ${horizontalClass} inline-flex max-w-[calc(100%-1rem)] items-center gap-1 rounded-md bg-canvas/95 px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-[0.1em] text-ink ring-1 ring-edge-soft/60 ${topClass}`}
    >
      <AwardLogo type={win.type} size={11} />
      <span className="truncate">{labelFor(win)}</span>
    </span>
  );
}

const AWARD_TAB_LABEL: Record<string, string> = {
  crunchyroll: "Crunchyroll",
  taaf: "TAAF",
  jmaf: "JMAF",
  r_anime: "r/anime",
  animation_kobe: "Kobe",
};

export function AnimeAwardTab({
  name,
  fallbackName,
  year,
  below = false,
  top = false,
  topClass: topClassOverride,
}: {
  name: string;
  fallbackName?: string;
  year?: number;
  below?: boolean;
  top?: boolean;
  topClass?: string;
}) {
  const primary = findTopAward(name, year);
  const win = primary ?? (fallbackName ? findTopAward(fallbackName, year) : null);
  if (!win) return null;
  const lookupName = primary ? name : (fallbackName ?? name);
  let label: string;
  if (win.source === "crunchyroll") {
    const count =
      findAnyAwardWins(lookupName, year).filter((w) => w.source === "crunchyroll").length || 1;
    label = `${count} ${count === 1 ? "Award" : "Awards"}`;
  } else {
    label = AWARD_TAB_LABEL[win.source] ?? awardSourceMeta(win.source).shortName;
  }
  return (
    <span
      className={`pointer-events-none absolute left-1/2 z-10 -translate-x-1/2 ${
        topClassOverride ?? (top ? "top-1.5" : below ? "bottom-1.5" : "bottom-7")
      }`}
    >
      <AwardTab label={label} />
    </span>
  );
}

export function AnimeAwardBadge({
  win,
  stacked,
  dubShift = false,
  ribbonShift = false,
  layout = "poster",
  side = "start",
}: {
  win: AwardWin;
  stacked: boolean;
  dubShift?: boolean;
  ribbonShift?: boolean;
  layout?: CardLayout;
  side?: "start" | "end";
}) {
  const t = useT();
  const src = awardSourceMeta(win.source);
  const custom = useAwardIcon(win.source);
  const short = shortCategory(win);
  const above = (dubShift ? 1 : 0) + (stacked ? 1 : 0);
  const label = above > 0 ? `${win.year}` : `${win.year} ${t(short)}`;
  const topClass = stackTop(above, ribbonShift, layout);
  const horizontalClass = side === "end" ? "end-2" : "start-2";
  return (
    <span
      className={`pointer-events-none absolute ${horizontalClass} inline-flex max-w-[calc(100%-1rem)] items-center gap-1 rounded-md bg-canvas/95 px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-[0.14em] text-ink ring-1 ring-edge-soft/60 ${topClass}`}
      title={`${src.name} · ${win.categoryName} (${win.year})`}
    >
      <img
        src={custom ?? src.iconSmall}
        alt=""
        width={11}
        height={11}
        className={`h-2.5 w-2.5 shrink-0 object-contain ${!custom && win.source === "animation_kobe" ? "brightness-0 invert" : ""}`}
        draggable={false}
      />
      <span className="truncate">{label}</span>
    </span>
  );
}
