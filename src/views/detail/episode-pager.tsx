import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { useState } from "react";
import { useT } from "@/lib/i18n";

export function EpisodePager({
  page,
  pageCount,
  total,
  pageSize,
  onChange,
  onGoToEpisode,
  maxEpisode,
}: {
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
  onChange: (p: number) => void;
  onGoToEpisode?: (n: number) => void;
  maxEpisode?: number;
}) {
  const t = useT();
  if (pageCount <= 1) return null;
  const start = page * pageSize + 1;
  const end = Math.min((page + 1) * pageSize, total);
  const pages = windowPages(page, pageCount);
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 pt-1">
      <span className="text-[12px] tabular-nums text-ink-subtle">
        {t("{start}-{end} of {total}", { start, end, total })}
      </span>
      <nav aria-label={t("Episode pages")} className="flex items-center gap-1">
        <NavBtn label={t("First page")} disabled={page === 0} onClick={() => onChange(0)}>
          <ChevronsLeft className="rtl:rotate-180" size={16} strokeWidth={2.2} />
        </NavBtn>
        <NavBtn label={t("Previous")} disabled={page === 0} onClick={() => onChange(page - 1)}>
          <ChevronLeft className="rtl:rotate-180" size={16} strokeWidth={2.2} />
        </NavBtn>
        {pages.map((p) => (
          <button
            key={p}
            aria-label={t("Page {n}", { n: p })}
            aria-current={p - 1 === page ? "page" : undefined}
            onClick={() => onChange(p - 1)}
            className={`h-8 min-w-8 rounded-lg px-2 text-[12.5px] font-medium tabular-nums transition-colors ${
              p - 1 === page
                ? "bg-ink text-canvas"
                : "text-ink-muted hover:bg-elevated hover:text-ink"
            }`}
          >
            {p}
          </button>
        ))}
        <PageNumberInput pageCount={pageCount} onGo={(target) => onChange(target - 1)} />
        <NavBtn
          label={t("Next")}
          disabled={page === pageCount - 1}
          onClick={() => onChange(page + 1)}
        >
          <ChevronRight className="rtl:rotate-180" size={16} strokeWidth={2.2} />
        </NavBtn>
        <NavBtn
          label={t("Last page")}
          disabled={page === pageCount - 1}
          onClick={() => onChange(pageCount - 1)}
        >
          <ChevronsRight className="rtl:rotate-180" size={16} strokeWidth={2.2} />
        </NavBtn>
      </nav>
      {onGoToEpisode && maxEpisode ? (
        <GoToEpisode max={maxEpisode} onGo={onGoToEpisode} />
      ) : (
        <span />
      )}
    </div>
  );
}

function PageNumberInput({ pageCount, onGo }: { pageCount: number; onGo: (page: number) => void }) {
  const t = useT();
  const [value, setValue] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const target = Number(value.trim());
        if (/^\d+$/.test(value.trim()) && target >= 1 && target <= pageCount) {
          onGo(target);
          setValue("");
        }
      }}
    >
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={String(pageCount).length}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={t("Page")}
        aria-label={t("Go to page")}
        title={t("Go to page")}
        className="h-8 w-14 rounded-lg bg-canvas px-1.5 text-center text-[12px] tabular-nums text-ink-subtle outline-none ring-1 ring-inset ring-edge-soft transition-colors focus:text-ink focus:ring-accent/50"
      />
    </form>
  );
}

function windowPages(page: number, count: number): number[] {
  const cur = page + 1;
  return [...new Set([1, count, cur - 2, cur - 1, cur, cur + 1, cur + 2])]
    .filter((number) => number >= 1 && number <= count)
    .sort((a, b) => a - b);
}

function NavBtn({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-elevated hover:text-ink disabled:pointer-events-none disabled:opacity-30"
    >
      {children}
    </button>
  );
}

function GoToEpisode({ max, onGo }: { max: number; onGo: (n: number) => void }) {
  const t = useT();
  const [v, setV] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const n = parseInt(v, 10);
        if (Number.isFinite(n) && n >= 1 && n <= max) {
          onGo(n);
          setV("");
        }
      }}
    >
      <input
        type="number"
        min={1}
        max={max}
        value={v}
        onChange={(e) => setV(e.target.value)}
        placeholder={t("Go to ep")}
        aria-label={t("Go to episode")}
        className="h-8 w-[104px] rounded-lg bg-canvas px-2.5 text-[12px] text-ink outline-none ring-1 ring-inset ring-edge-soft transition-colors focus:ring-accent/50"
      />
    </form>
  );
}
