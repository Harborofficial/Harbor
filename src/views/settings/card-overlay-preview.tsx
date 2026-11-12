import { Bookmark } from "./icons";
import { useSettings } from "@/lib/settings";
import { useT } from "@/lib/i18n";
import { useSampleArtwork } from "@/lib/sample-artwork";
import { AwardTab } from "@/components/award-tab";
import { ClassicAwardBadge } from "@/components/card-award";
import { stackTop } from "@/components/card-status-badges";
import { TopTenRibbon } from "@/components/top-ten-ribbon";
import type { Settings } from "@/lib/settings";

export function CardOverlayPreview({
  layout = "poster",
  settings: previewSettings,
  cardWidth,
}: {
  layout?: "poster" | "tv";
  settings?: Settings;
  cardWidth: number;
}) {
  const { settings: savedSettings } = useSettings();
  const settings = previewSettings ?? savedSettings;
  const t = useT();
  const art = useSampleArtwork(9);
  const ribbonSide = settings.top10RibbonSide;
  const watchlist = settings.watchlistBadge;
  const sharesRibbonCorner =
    layout === "poster" &&
    settings.top10Ribbon &&
    ((watchlist === "topStart" && ribbonSide === "left") ||
      (watchlist === "topEnd" && ribbonSide === "right"));
  const tvRibbonLeft = layout === "tv" && settings.top10Ribbon && ribbonSide === "left";
  const tvRibbonRight = layout === "tv" && settings.top10Ribbon && ribbonSide === "right";
  const tvLeftSlots =
    (tvRibbonLeft ? 1 : 0) + (layout === "tv" && settings.cardAwardDisplay === "badge" ? 1 : 0);
  const tvStartTop = tvLeftSlots > 0 ? stackTop(tvLeftSlots, false, "tv", true) : "top-2";
  const tvEndTop = tvRibbonRight ? stackTop(1, false, "tv", true) : "top-2";
  const start = layout === "tv" ? "start-2" : "start-1.5";
  const end = layout === "tv" ? "end-2" : "end-1.5";
  const markCorner = {
    off: "",
    topStart: `${layout === "tv" ? tvStartTop : sharesRibbonCorner ? "top-[34px]" : "top-1.5"} ${start}`,
    topEnd: `${layout === "tv" ? tvEndTop : sharesRibbonCorner ? "top-[34px]" : "top-1.5"} ${end}`,
    bottomStart: `${layout === "tv" ? "bottom-2" : "bottom-1.5"} ${start}`,
    bottomEnd: `${layout === "tv" ? "bottom-2" : "bottom-1.5"} ${end}`,
  }[watchlist];
  return (
    <div className="flex flex-col items-center gap-4 rounded-[12px] bg-elevated px-5 py-6">
      <div
        className={`relative shrink-0 overflow-hidden rounded-md ring-1 ring-edge-soft ${
          layout === "tv" ? "aspect-[16/9] max-w-full" : "w-[164px]"
        }`}
        style={layout === "tv" ? { width: cardWidth } : { aspectRatio: "2 / 3" }}
      >
        <img
          src={layout === "tv" ? art.background : art.poster}
          alt=""
          draggable={false}
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div
          className={`absolute inset-x-0 bottom-0 ${layout === "tv" ? "h-full bg-gradient-to-t from-black/90 via-black/25 to-black/5" : "h-1/2 bg-gradient-to-t from-black/55 to-transparent"}`}
        />
        {layout === "tv" && (
          <div className="absolute inset-x-3 bottom-3 flex items-end gap-2.5">
            <img
              src={art.poster}
              alt=""
              draggable={false}
              className="h-[54px] w-[36px] shrink-0 rounded-sm object-cover shadow-[0_4px_12px_rgba(0,0,0,0.7)] ring-1 ring-white/20"
            />
            <span className="mb-0.5 min-w-0 text-[14px] font-semibold leading-tight text-white [text-shadow:0_1px_8px_rgba(0,0,0,0.9)]">
              {art.name}
            </span>
          </div>
        )}
        {settings.top10Ribbon && <TopTenRibbon side={ribbonSide} />}
        {watchlist !== "off" && (
          <span
            className={`absolute ${markCorner} flex ${layout === "tv" ? "h-6 w-6" : "h-5 w-5"} items-center justify-center rounded-full bg-canvas/85 text-ink ring-1 ring-edge-soft/70`}
            title={t("In watchlist")}
          >
            <Bookmark size={layout === "tv" ? 12 : 10} strokeWidth={2.6} fill="currentColor" />
          </span>
        )}
        {settings.cardAwardDisplay === "tabs" && (
          <span
            className={`pointer-events-none absolute left-1/2 z-10 -translate-x-1/2 ${
              layout === "tv"
                ? "top-2"
                : settings.awardTabPosition === "top"
                  ? "top-1.5"
                  : settings.awardTabPosition === "below"
                    ? "bottom-1.5"
                    : "bottom-7"
            }`}
          >
            <AwardTab label="TAAF" />
          </span>
        )}
        {settings.cardAwardDisplay === "badge" && (
          <ClassicAwardBadge
            win={{ type: "oscar", wins: 1 }}
            topClass={layout === "tv" ? stackTop(0, tvRibbonLeft, "tv") : "top-2"}
          />
        )}
      </div>
      <span className="text-center text-[14px] leading-5 text-ink-muted">
        {t("Ribbon, award and bookmark preview")}
      </span>
    </div>
  );
}
