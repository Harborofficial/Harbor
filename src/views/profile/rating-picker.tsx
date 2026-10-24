import { Quote, Star, X } from "lucide-react";
import { useEffect, useMemo, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useT } from "@/lib/i18n";
import { useRatingPoster } from "@/lib/ratings/poster";
import type { RatingQuote } from "@/lib/ratings/quote";
import { rankRatingOptions, ratingToken, type RatingSource } from "@/lib/ratings/trigger";
import type { PublicRating } from "@/lib/ratings/types";
import { fetchFriends } from "@/lib/social/friends";
import { currentAuthor } from "@/lib/theme-auth";
import { loadRatings } from "./use-quoted-rating";

const MAX_FRIENDS = 8;

/** The profile owner, the author and their friends, in the order the picker offers them. */
export function useRatingSources(ownerHandle?: string): RatingSource[] {
  const myHandle = currentAuthor()?.handle ?? "";
  const [friends, setFriends] = useState<RatingSource[]>([]);

  useEffect(() => {
    if (!myHandle) return;
    let live = true;
    void fetchFriends().then((list) => {
      if (!live) return;
      setFriends(
        list.slice(0, MAX_FRIENDS).map((friend) => ({
          handle: friend.handle,
          label: friend.alias || friend.handle,
          kind: "friend" as const,
        })),
      );
    });
    return () => {
      live = false;
    };
  }, [myHandle]);

  return useMemo(() => {
    const out: RatingSource[] = [];
    const seen = new Set<string>();
    const add = (source: RatingSource) => {
      const key = source.handle.toLowerCase();
      if (!source.handle || seen.has(key)) return;
      seen.add(key);
      out.push(source);
    };
    if (ownerHandle) add({ handle: ownerHandle, kind: "owner" });
    if (myHandle) add({ handle: myHandle, kind: "me" });
    for (const friend of friends) add(friend);
    return out;
  }, [ownerHandle, myHandle, friends]);
}

export type RatingSuggest = ReturnType<typeof useRatingSuggest>;

/** Typing "#" in a composer offers ratings to quote, from any of the given people. */
export function useRatingSuggest(text: string, caret: number, sources: RatingSource[]) {
  const token = useMemo(
    () => (sources.length ? ratingToken(text, caret) : null),
    [text, caret, sources.length],
  );
  const active = !!token;
  const [sourceIndex, setSourceIndex] = useState(0);
  const source = sources[Math.min(sourceIndex, sources.length - 1)];
  const handle = source?.handle ?? "";
  const [ratings, setRatings] = useState<PublicRating[]>([]);
  const [loadedHandle, setLoadedHandle] = useState("");
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!active || !handle) {
      setDismissedAt(null);
      return;
    }
    let live = true;
    void loadRatings(handle).then((list) => {
      if (!live) return;
      setRatings(list);
      setLoadedHandle(handle);
    });
    return () => {
      live = false;
    };
  }, [active, handle]);

  const ready = loadedHandle === handle;
  const options = useMemo(
    () => (token && ready ? rankRatingOptions(ratings, token.query) : []),
    [ratings, token, ready],
  );
  const open = !!token && options.length > 0 && dismissedAt !== token.start;
  const current = Math.max(0, Math.min(index, options.length - 1));

  useEffect(() => {
    setIndex(0);
  }, [token?.query, handle]);

  return {
    token,
    source,
    sources,
    options,
    open,
    loading: !!token && !ready && dismissedAt === null,
    index: current,
    move: (step: number) =>
      setIndex((i) => (options.length ? (i + step + options.length) % options.length : 0)),
    hover: setIndex,
    setSource: setSourceIndex,
    cycleSource: (step: number) =>
      setSourceIndex((i) => (sources.length ? (i + step + sources.length) % sources.length : 0)),
    dismiss: () => setDismissedAt(token?.start ?? null),
  };
}

/** Handles the picker's keys, so every composer behaves the same. */
export function ratingPickerKey(
  e: ReactKeyboardEvent<HTMLTextAreaElement>,
  suggest: RatingSuggest,
  onPick: (rating: PublicRating) => void,
): boolean {
  if (!suggest.open) return false;
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    suggest.move(e.key === "ArrowDown" ? 1 : -1);
    return true;
  }
  if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
    e.preventDefault();
    suggest.cycleSource(e.key === "ArrowRight" ? 1 : -1);
    return true;
  }
  if (e.key === "Enter" || e.key === "Tab") {
    e.preventDefault();
    const rating = suggest.options[suggest.index];
    if (rating) onPick(rating);
    return true;
  }
  if (e.key === "Escape") {
    e.stopPropagation();
    suggest.dismiss();
    return true;
  }
  return false;
}

export function RatingPicker({
  suggest,
  onPick,
}: {
  suggest: RatingSuggest;
  onPick: (rating: PublicRating) => void;
}) {
  const t = useT();
  if (!suggest.token || (!suggest.open && !suggest.loading)) return null;
  const many = suggest.sources.length > 1;
  return (
    <div
      role="listbox"
      aria-label={t("Ratings you can quote")}
      className="absolute bottom-full start-0 z-30 mb-2 w-full overflow-hidden rounded-[12px] border border-edge-soft bg-elevated py-1 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.7)]"
    >
      {many && (
        <div className="mb-1 flex gap-1 overflow-x-auto border-b border-edge-soft px-2 pb-2">
          {suggest.sources.map((source, i) => (
            <button
              key={source.handle}
              type="button"
              aria-pressed={suggest.source?.handle === source.handle}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => suggest.setSource(i)}
              className={`shrink-0 rounded-full px-2.5 py-1 text-[11.5px] font-medium transition-colors ${
                suggest.source?.handle === source.handle
                  ? "bg-ink text-canvas"
                  : "text-ink-muted hover:bg-raised hover:text-ink"
              }`}
            >
              {sourceLabel(source, t)}
            </button>
          ))}
        </div>
      )}
      {suggest.open ? (
        suggest.options.map((r, i) => (
          <button
            key={`${r.itemKey}:${r.score}`}
            type="button"
            role="option"
            aria-selected={i === suggest.index}
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={() => suggest.hover(i)}
            onClick={() => onPick(r)}
            className={`flex w-full items-center gap-2.5 px-2.5 py-1.5 text-start transition-colors ${
              i === suggest.index ? "bg-raised" : ""
            }`}
          >
            <OptionPoster rating={r} />
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">
              {r.title}
            </span>
            <span className="inline-flex shrink-0 items-center gap-0.5 text-[12px] font-bold tabular-nums text-ink-muted">
              <Star size={11} className="fill-current" />
              {r.score}
            </span>
          </button>
        ))
      ) : (
        <p className="px-3 py-2 text-[12.5px] text-ink-subtle">{t("Loading ratings…")}</p>
      )}
    </div>
  );
}

function sourceLabel(source: RatingSource, t: (key: string) => string): string {
  if (source.kind === "owner") return t("This profile");
  if (source.kind === "me") return t("You");
  return source.label || `@${source.handle}`;
}

/** The rating a composer is about to comment on. */
export function QuoteChip({ quote, onRemove }: { quote: RatingQuote; onRemove: () => void }) {
  const t = useT();
  return (
    <div className="mb-2 flex items-center gap-2 rounded-[10px] border border-edge-soft bg-canvas/40 px-2.5 py-1.5">
      <Quote size={14} className="shrink-0 text-ink-subtle" />
      <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-muted">
        {t("Commenting on @{handle}'s rating", { handle: quote.authorHandle })}
      </span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={t("Remove quoted rating")}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-ink-subtle transition-colors hover:bg-elevated hover:text-ink"
      >
        <X size={14} />
      </button>
    </div>
  );
}

function OptionPoster({ rating }: { rating: PublicRating }) {
  const poster = useRatingPoster(rating.itemKey, rating.mediaType, rating.title, rating.posterUrl);
  return (
    <span className="h-10 w-7 shrink-0 overflow-hidden rounded-[4px] bg-surface ring-1 ring-edge-soft">
      {poster ? (
        <img src={poster} alt="" className="h-full w-full object-cover" loading="lazy" />
      ) : null}
    </span>
  );
}
