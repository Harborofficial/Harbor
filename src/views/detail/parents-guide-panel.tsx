import { useState } from "react";
import {
  Check,
  ChevronDown,
  ExternalLink,
  Ghost,
  Heart,
  Info,
  Loader2,
  MessageSquareWarning,
  RotateCcw,
  Swords,
  Wine,
} from "lucide-react";
import { openUrl } from "@/lib/window";
import { useT } from "@/lib/i18n";
import { useSettings } from "@/lib/settings";
import {
  severityColorStyle,
  type ParentsGuideCategory,
  type ParentsGuideResult,
} from "@/lib/providers/imdb-parents-guide";
import { useParentsGuide } from "./use-parents-guide";

const KEEP_EXPANDED_KEY = "harbor.content-advisory.keep-expanded";

const SEV_RANK: Record<string, number> = {
  unrated: -1,
  none: 0,
  mild: 1,
  moderate: 2,
  severe: 3,
};

function getCategoryIcon(id: string, label: string) {
  const norm = `${id} ${label}`.toLowerCase();
  if (norm.includes("sex") || norm.includes("nudity")) return Heart;
  if (norm.includes("violence") || norm.includes("gore")) return Swords;
  if (norm.includes("profanity") || norm.includes("language")) return MessageSquareWarning;
  if (norm.includes("alcohol") || norm.includes("drug") || norm.includes("smoking")) return Wine;
  if (norm.includes("frighten") || norm.includes("intense")) return Ghost;
  return Info;
}

export function ParentsGuidePanel({
  imdbId,
  guide: propGuide,
  loading: propLoading,
}: {
  imdbId: string | null;
  guide?: ParentsGuideResult | null;
  loading?: boolean;
}) {
  const t = useT();

  const [keepExpanded, setKeepExpanded] = useState<boolean>(() => {
    try {
      return localStorage.getItem(KEEP_EXPANDED_KEY) === "1";
    } catch {
      return false;
    }
  });

  // Default to collapsed unless keepExpanded is true
  const [sectionCollapsed, setSectionCollapsed] = useState<boolean>(!keepExpanded);
  const [expandedCats, setExpandedCats] = useState<Set<string>>(() => new Set());
  const [revealedSpoilers, setRevealedSpoilers] = useState<Set<string>>(() => new Set());

  // Only enable internal fetching if the section is expanded (or keepExpanded)
  const isFetchEnabled = propGuide !== undefined ? false : !sectionCollapsed;
  const internalData = useParentsGuide(propGuide === undefined ? imdbId : null, {
    enabled: isFetchEnabled,
  });
  const guide = propGuide !== undefined ? propGuide : internalData.guide;
  const loading = propLoading !== undefined ? propLoading : internalData.loading;

  const handleKeepExpandedChange = (checked: boolean) => {
    setKeepExpanded(checked);
    try {
      if (checked) {
        localStorage.setItem(KEEP_EXPANDED_KEY, "1");
      } else {
        localStorage.removeItem(KEEP_EXPANDED_KEY);
      }
    } catch {
      void 0;
    }
  };

  // When guide is explicitly passed from outside, hide if empty & not loading
  if (propGuide !== undefined && !loading && (!guide || guide.categories.length === 0)) {
    return null;
  }

  const toggleCategory = (id: string) => {
    setExpandedCats((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSpoilers = (id: string) => {
    setRevealedSpoilers((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const imdbGuideUrl = imdbId ? `https://www.imdb.com/title/${imdbId}/parentalguide` : null;

  return (
    <section className="flex flex-col pt-3" data-testid="parents-guide-section">
      {/* Heading row with Keep expanded, Collapse/Expand, and IMDb links */}
      <div className="mb-4 flex items-center justify-between gap-4">
        <h3 className="text-[22px] font-medium tracking-tight text-ink">{t("Content Advisory")}</h3>
        <div className="flex items-center gap-2">
          {/* Keep expanded toggle visible when the section is expanded */}
          {!sectionCollapsed && (
            <button
              type="button"
              role="checkbox"
              aria-checked={keepExpanded}
              onClick={() => handleKeepExpandedChange(!keepExpanded)}
              title={t("Keep this section expanded by default on future titles")}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                keepExpanded
                  ? "bg-white/[0.12] text-ink ring-1 ring-white/20 hover:bg-white/[0.16]"
                  : "bg-white/[0.06] text-ink-muted hover:bg-white/[0.10] hover:text-ink"
              }`}
            >
              <span
                aria-hidden="true"
                className={`flex h-3.5 w-3.5 items-center justify-center rounded-[3px] transition-colors ${
                  keepExpanded ? "bg-accent text-canvas" : "border border-white/25 bg-white/[0.04]"
                }`}
              >
                {keepExpanded && <Check size={10} strokeWidth={3} />}
              </span>
              <span>{t("Keep expanded")}</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setSectionCollapsed((c) => !c)}
            className="flex items-center gap-1.5 rounded-lg bg-white/[0.06] px-3 py-1.5 text-[12.5px] font-medium text-ink-muted transition-colors hover:bg-white/[0.10] hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            aria-expanded={!sectionCollapsed}
            aria-controls="parents-guide-content"
          >
            <span>{sectionCollapsed ? t("Expand") : t("Collapse")}</span>
            <ChevronDown
              size={13}
              strokeWidth={2.2}
              className={`transition-transform duration-200 ${sectionCollapsed ? "" : "rotate-180"}`}
            />
          </button>
          {imdbGuideUrl && (
            <button
              type="button"
              onClick={() => openUrl(imdbGuideUrl)}
              className="flex items-center gap-1.5 rounded-lg bg-white/[0.06] px-3 py-1.5 text-[12.5px] font-medium text-ink-muted transition-colors hover:bg-white/[0.10] hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              {t("Open on IMDb")}
              <ExternalLink size={12} strokeWidth={2.2} />
            </button>
          )}
        </div>
      </div>

      {/* Collapsible Content Area */}
      <div
        id="parents-guide-content"
        className={`grid transition-[grid-template-rows] duration-200 ease-out ${
          sectionCollapsed ? "grid-rows-[0fr]" : "grid-rows-[1fr]"
        }`}
        inert={sectionCollapsed ? true : undefined}
        aria-hidden={sectionCollapsed ? true : undefined}
      >
        <div className="overflow-hidden">
          {!sectionCollapsed &&
            (loading && !guide ? (
              <div className="flex items-center gap-2 py-6 text-[13px] text-ink-subtle">
                <Loader2 size={14} className="animate-spin" />
                {t("Loading Content Advisory…")}
              </div>
            ) : internalData.error && !guide ? (
              <div className="flex items-center justify-between py-4 text-[13px] text-ink-muted">
                <span>{t("Failed to load Content Advisory.")}</span>
                <button
                  type="button"
                  onClick={internalData.retry}
                  className="flex items-center gap-1.5 rounded-lg bg-white/[0.06] px-3 py-1.5 text-[12px] font-medium text-ink transition-colors hover:bg-white/[0.10] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <RotateCcw size={12} />
                  <span>{t("Retry")}</span>
                </button>
              </div>
            ) : !guide || guide.categories.length === 0 ? (
              <div className="py-4 text-[13px] text-ink-muted">
                {t("No detailed content advisory submitted for this title on IMDb.")}
              </div>
            ) : (
              <div className="flex flex-col gap-2.5 pt-1">
                {guide.categories.map((cat) => (
                  <CategoryRow
                    key={cat.id || cat.label}
                    category={cat}
                    expanded={expandedCats.has(cat.id)}
                    spoilersRevealed={revealedSpoilers.has(cat.id)}
                    imdbGuideUrl={imdbGuideUrl}
                    onToggle={() => toggleCategory(cat.id)}
                    onToggleSpoilers={() => toggleSpoilers(cat.id)}
                  />
                ))}
              </div>
            ))}
        </div>
      </div>
    </section>
  );
}

function CategoryRow({
  category,
  expanded,
  spoilersRevealed,
  imdbGuideUrl,
  onToggle,
  onToggleSpoilers,
}: {
  category: ParentsGuideCategory;
  expanded: boolean;
  spoilersRevealed: boolean;
  imdbGuideUrl?: string | null;
  onToggle: () => void;
  onToggleSpoilers: () => void;
}) {
  const t = useT();
  const { settings } = useSettings();
  const color = severityColorStyle(category.severity, settings.contentAdvisoryTheme);
  const rank = SEV_RANK[category.severity.toLowerCase()] ?? 0;
  const CategoryIcon = getCategoryIcon(category.id, category.label);
  const plainItems = category.items.filter((item) => !item.isSpoiler);
  const spoilerItems = category.items.filter((item) => item.isSpoiler);
  const hasNotes = category.items.length > 0;
  const contentId = `parents-guide-cat-${category.id}`;

  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-edge-soft/60 bg-white/[0.04] transition-colors duration-150 hover:bg-white/[0.07]">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={contentId}
        className="flex w-full cursor-pointer items-center justify-between gap-3 px-4 py-3.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        {/* Left side: Category Icon + Category Label */}
        <div className="flex min-w-0 items-center gap-3">
          <CategoryIcon
            size={16}
            strokeWidth={2}
            className={`shrink-0 ${color.textClass}`}
            aria-hidden="true"
          />
          <span className="truncate text-[14px] font-medium text-ink">{t(category.label)}</span>
        </div>

        {/* Right side: Badge + Thin Boxy Meter + Chevron */}
        <div className="flex shrink-0 items-center gap-3">
          {/* Severity Badge */}
          <span
            className={`rounded-md border px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wider ${color.badgeClass}`}
          >
            {category.severity.toLowerCase() === "unrated" ? "—" : category.severity.toUpperCase()}
          </span>

          {/* 3-Segment Visual Boxy Meter */}
          <div className="flex items-center gap-[3px]" aria-hidden="true">
            {[1, 2, 3].map((lvl) => (
              <span
                key={lvl}
                className={`h-3.5 w-1 rounded-[2px] transition-colors ${
                  lvl <= rank ? `${color.barClass} opacity-95` : "bg-white/10 opacity-30"
                }`}
              />
            ))}
          </div>

          {/* Chevron */}
          <ChevronDown
            size={16}
            className={`text-ink-muted transition-transform duration-200 ${
              expanded ? "rotate-180 text-ink" : ""
            }`}
          />
        </div>
      </button>

      {/* Accordion Notes Dropdown */}
      <div
        id={contentId}
        className={`grid transition-[grid-template-rows] duration-200 ease-out ${
          expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
        inert={!expanded ? true : undefined}
        aria-hidden={!expanded ? true : undefined}
      >
        <div className="overflow-hidden">
          {expanded && (
            <div className="flex flex-col gap-2.5 border-t border-edge-soft/40 bg-white/[0.02] px-4 py-3.5 opacity-100 transition-opacity duration-200">
              {category.totalVotes > 0 && category.severity.toLowerCase() !== "unrated" && (
                <div className="text-[11.5px] font-medium text-ink-subtle">
                  {t("{votedFor} of {totalVotes} users rated {severity}", {
                    votedFor: category.severityVotes,
                    totalVotes: category.totalVotes,
                    severity: category.severity.toLowerCase(),
                  })}
                </div>
              )}

              {hasNotes ? (
                <>
                  {plainItems.length > 0 && (
                    <ul className="flex flex-col gap-2">
                      {plainItems.map((item, idx) => (
                        <li
                          key={idx}
                          className="flex items-start gap-2 text-[12.5px] leading-relaxed text-ink-muted"
                        >
                          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-ink-subtle/50" />
                          <span>{item.text}</span>
                        </li>
                      ))}
                    </ul>
                  )}

                  {spoilerItems.length > 0 && (
                    <div className="flex flex-col gap-2 pt-1">
                      <button
                        type="button"
                        onClick={onToggleSpoilers}
                        className="self-start rounded-full border border-edge-soft bg-white/[0.04] px-3 py-1 text-[11px] font-semibold tracking-wide text-amber-400 transition-colors hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      >
                        {spoilersRevealed
                          ? t("Hide spoilers")
                          : t("{count} spoiler entry hidden — SHOW", {
                              count: spoilerItems.length,
                            })}
                      </button>

                      {spoilersRevealed && (
                        <ul className="flex flex-col gap-2 border-l-2 border-amber-500/30 pl-2">
                          {spoilerItems.map((item, idx) => (
                            <li
                              key={idx}
                              className="flex items-start gap-2 text-[12.5px] leading-relaxed text-ink-muted"
                            >
                              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400/60" />
                              <span>{item.text}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <div className="text-[12.5px] italic text-ink-muted/80">
                  {t("No detailed notes submitted for this category.")}
                </div>
              )}

              {category.totalItems > category.items.length && (
                <div className="flex items-center justify-between gap-3 border-t border-edge-soft/30 pt-2 text-[11.5px] text-ink-subtle">
                  <span>
                    {t("Showing {shown} of {total} notes", {
                      shown: category.items.length,
                      total: category.totalItems,
                    })}
                  </span>
                  {imdbGuideUrl && (
                    <button
                      type="button"
                      onClick={() => openUrl(imdbGuideUrl)}
                      className="inline-flex items-center gap-1 font-medium text-ink-muted transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                    >
                      <span>{t("Open on IMDb")}</span>
                      <ExternalLink size={11} strokeWidth={2.2} />
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
