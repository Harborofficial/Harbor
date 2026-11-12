import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export function EntryPicker({
  entries,
  activeId,
  onSelect,
  specials,
}: {
  entries: Array<{ id: string; label: string }>;
  activeId: string;
  onSelect: (id: string) => void;
  specials?: { label: string; active: boolean; onSelect: () => void };
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  const active = entries.find((entry) => entry.id === activeId) ?? entries[0];
  const activeLabel = specials?.active ? specials.label : active?.label;
  if (!activeLabel) return null;

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex h-9 max-w-[220px] items-center gap-1.5 rounded-full bg-white/10 ps-3.5 pe-2.5 text-[13px] font-semibold text-ink transition-colors hover:bg-white/[0.15]"
      >
        <span className="min-w-0 truncate" title={activeLabel}>
          {activeLabel}
        </span>
        <ChevronDown
          size={15}
          strokeWidth={2.4}
          className={`shrink-0 text-ink-muted transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div
          role="listbox"
          className="absolute end-0 top-full z-30 mt-2 max-h-[52vh] w-64 overflow-y-auto rounded-md bg-elevated p-1.5 shadow-[0_10px_30px_-12px_rgba(0,0,0,0.6)] animate-in fade-in slide-in-from-top-1 duration-150"
        >
          {specials && (
            <button
              role="option"
              aria-selected={specials.active}
              title={specials.label}
              onClick={() => {
                specials.onSelect();
                setOpen(false);
              }}
              className={`flex w-full items-center rounded-md px-3.5 py-2.5 text-start text-[13.5px] transition-colors ${
                specials.active
                  ? "bg-accent font-semibold text-canvas"
                  : "text-ink-muted hover:bg-raised hover:text-ink"
              }`}
            >
              <span className="truncate">{specials.label}</span>
            </button>
          )}
          {entries.map((entry) => (
            <button
              key={entry.id}
              role="option"
              aria-selected={entry.id === activeId && !specials?.active}
              title={entry.label}
              onClick={() => {
                onSelect(entry.id);
                setOpen(false);
              }}
              className={`flex w-full items-center rounded-md px-3.5 py-2.5 text-start text-[13.5px] transition-colors ${
                entry.id === activeId && !specials?.active
                  ? "bg-accent font-semibold text-canvas"
                  : "text-ink-muted hover:bg-raised hover:text-ink"
              }`}
            >
              <span className="truncate">{entry.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
