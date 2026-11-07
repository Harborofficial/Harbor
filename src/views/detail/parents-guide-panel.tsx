import { useState } from "react";
import {
  ChevronDown,
  ExternalLink,
  Ghost,
  Heart,
  Info,
  Loader2,
  MessageSquareWarning,
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
  const internalData = useParentsGuide(propGuide === undefined ? imdbId : null);
  const guide = propGuide !== undefined ? propGuide : internalData.guide;
  const loading = propLoading !== undefined ? propLoading : internalData.loading;

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

  if (!loading && (!guide || guide.categories.length === 0)) {
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
            <label
              className="flex cursor-pointer select-none items-center gap-1.5 rounded-lg bg-white/[0.06] px-2.5 py-1.5 text-[12px] font-medium text-ink-muted transition-colors hover:bg-white/[0.10] hover:text-ink focus-within:ring-2 focus-within:ring-primary"
              title={t("Keep this section expanded by default on future titles")}
            >
              <input
                type="checkbox"
                checked={keepExpanded}
                onChange={(e) => handleKeepExpandedChange(e.target.checked)}
                className="h-3.5 w-3.5 cursor-pointer rounded border-white/20 bg-white/10 text-primary accent-primary"
              />
              <span>{t("Keep expanded")}</span>
            </label>
          )}

          <button
            type="button"
            onClick={() => setSectionCollapsed((c) => !c)}
            className="flex items-center gap-1.5 rounded-lg bg-white/[0.06] px-3 py-1.5 text-[12.5px] font-medium text-ink-muted transition-colors hover:bg-white/[0.10] hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            aria-expanded={!sectionCollapsed}
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
        className={`grid transition-[grid-template-rows] duration-200 ease-out ${
          sectionCollapsed ? "grid-rows-[0fr]" : "grid-rows-[1fr]"
        }`}
      >
        <div className="overflow-hidden">
          {loading && !guide ? (
            <div className="flex items-center gap-2 py-6 text-[13px] text-ink-subtle">
              <Loader2 size={14} className="animate-spin" />
              {t("Loading Content Advisory…")}
            </div>
          ) : (
            <div className="flex flex-col gap-2.5 pt-1">
              {guide?.categories.map((cat) => (
                <CategoryRow
                  key={cat.id || cat.label}
                  category={cat}
                  expanded={expandedCats.has(cat.id)}
                  spoilersRevealed={revealedSpoilers.has(cat.id)}
                  onToggle={() => toggleCategory(cat.id)}
                  onToggleSpoilers={() => toggleSpoilers(cat.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function CategoryRow({
  category,
  expanded,
  spoilersRevealed,
  onToggle,
  onToggleSpoilers,
}: {
  category: ParentsGuideCategory;
  expanded: boolean;
  spoilersRevealed: boolean;
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

  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-edge-soft/60 bg-white/[0.04] transition-colors duration-150 hover:bg-white/[0.07]">
      <button
        type="button"
        onClick={onToggle}
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
            {category.severity.toUpperCase()}
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
        className={`grid transition-[grid-template-rows] duration-200 ease-out ${
          expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        <div className="overflow-hidden">
          <div
            className={`flex flex-col gap-2.5 border-t border-edge-soft/40 bg-white/[0.02] px-4 py-3.5 transition-opacity duration-200 ${
              expanded ? "opacity-100" : "opacity-0"
            }`}
          >
            {category.totalVotes > 0 && (
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
          </div>
        </div>
      </div>
    </div>
  );
}
