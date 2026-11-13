import { ArrowDownWideNarrow, ArrowUpNarrowWide, Check, ChevronDown } from "lucide-react";
import { useT } from "@/lib/i18n";
import { SOURCE_SORTS, type SourceSort } from "@/lib/streams/source-sort";

export function useSourceSortLabel() {
  const t = useT();
  return (value: SourceSort) => {
    switch (value) {
      case "size-desc":
        return t("Largest first");
      case "size-asc":
        return t("Smallest first");
      case "seeders-desc":
        return t("Most seeders");
      default:
        return t("Default order");
    }
  };
}

export function SourceSortMenu({
  value,
  open,
  onToggle,
  onClose,
  onPick,
}: {
  value: SourceSort;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  onPick: (value: SourceSort) => void;
}) {
  const t = useT();
  const label = useSourceSortLabel();
  const active = value !== "default";
  const Icon = value === "size-asc" ? ArrowUpNarrowWide : ArrowDownWideNarrow;
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-label={t("Sort sources: {value}", { value: label(value) })}
        className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] font-semibold transition-colors ${
          active
            ? "bg-ink text-canvas"
            : "bg-elevated/50 text-ink-muted ring-1 ring-edge-soft/60 hover:bg-elevated hover:text-ink"
        }`}
      >
        <Icon size={13} strokeWidth={2.4} />
        {active ? label(value) : t("Sort")}
        <ChevronDown
          size={12}
          strokeWidth={2.4}
          className={`transition-transform duration-150 ${open ? "rotate-180" : ""} ${
            active ? "text-canvas/70" : "text-ink-subtle"
          }`}
        />
      </button>
      {open && (
        <>
          <button
            type="button"
            aria-label={t("Close menu")}
            onClick={onClose}
            className="fixed inset-0 z-10 cursor-default"
          />
          <div className="absolute start-0 top-full z-20 mt-1 min-w-[176px] rounded-xl bg-elevated p-1 ring-1 ring-edge shadow-[0_18px_44px_-14px_rgba(0,0,0,0.7)]">
            {SOURCE_SORTS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => onPick(option)}
                aria-pressed={value === option}
                className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-start text-[13px] transition-colors hover:bg-raised ${
                  value === option ? "font-semibold text-ink" : "text-ink-muted"
                }`}
              >
                <span className="flex-1 truncate">{label(option)}</span>
                <Check
                  size={13}
                  strokeWidth={2.6}
                  className={value === option ? "text-ink" : "invisible"}
                />
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
