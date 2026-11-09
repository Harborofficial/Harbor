import { Quote, RotateCcw, Star, Users, X } from "lucide-react";
import { useEffect, useMemo, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useT } from "@/lib/i18n";
import { useRatingPoster } from "@/lib/ratings/poster";
import type { RatingQuote } from "@/lib/ratings/quote";
import {
  rankRatingOptions,
  ratingToken,
  sourceLabel,
  type RatingSource,
} from "@/lib/ratings/trigger";
import type { PublicRating } from "@/lib/ratings/types";
import { fetchFriends } from "@/lib/social/friends";
import { currentAuthor, subscribeAuthor } from "@/lib/theme-auth";
import { Avatar } from "./profile-bits";
import { PeoplePanel } from "./rating-people";
import { loadRatings } from "./use-quoted-rating";

/** The profile owner, the author and their friends, in the order the picker offers them. */
export function useRatingSources(ownerHandle?: string, ownerAvatar?: string): RatingSource[] {
  const me = currentAuthor();
  const myHandle = me?.handle ?? "";
  const myAvatar = me?.avatar ?? undefined;
  const [friends, setFriends] = useState<RatingSource[]>([]);

  useEffect(() => {
    if (!myHandle) return;
    let live = true;
    void fetchFriends().then((list) => {
      if (!live) return;
      setFriends(
        list.map((friend) => ({
          handle: friend.handle,
          label: friend.alias || friend.handle,
          kind: "friend" as const,
          avatarUrl: friend.avatarUrl,
          online: friend.online,
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
    if (ownerHandle) add({ handle: ownerHandle, kind: "owner", avatarUrl: ownerAvatar });
    if (myHandle) add({ handle: myHandle, kind: "me", avatarUrl: myAvatar });
    for (const friend of friends) add(friend);
    return out;
  }, [ownerHandle, ownerAvatar, myHandle, myAvatar, friends]);
}

export type RatingSuggest = ReturnType<typeof useRatingSuggest>;

/** Typing "#" in a composer offers ratings to quote, from any of the given people. */
export function useRatingSuggest(text: string, caret: number, sources: RatingSource[]) {
  // People taken from the person search stay quotable for as long as this composer is mounted.
  const [picked, setPicked] = useState<RatingSource[]>([]);
  const all = useMemo(() => {
    const out = [...sources];
    const seen = new Set(out.map((source) => source.handle.toLowerCase()));
    for (const source of picked) {
      const key = source.handle.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(source);
    }
    return out;
  }, [sources, picked]);

  const [selected, setSelected] = useState("");
  const source = useMemo(
    () =>
      all.find((person) => person.handle.toLowerCase() === selected.toLowerCase()) ??
      all[0] ??
      null,
    [all, selected],
  );

  const token = useMemo(() => (all.length ? ratingToken(text, caret) : null), [text, caret, all]);
  const active = !!token;
  const handle = source?.handle ?? "";
  const [view, setView] = useState<"ratings" | "people">("ratings");
  const [ratings, setRatings] = useState<PublicRating[]>([]);
  const [loadedHandle, setLoadedHandle] = useState("");
  const [partial, setPartial] = useState(false);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const [index, setIndex] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [sessionRevision, setSessionRevision] = useState(0);

  useEffect(() => subscribeAuthor(() => setSessionRevision((revision) => revision + 1)), []);

  useEffect(() => {
    if (!active || !handle) {
      setDismissedAt(null);
      return;
    }
    let live = true;
    // Ratings are scoped to the active session; don't keep the previous session's list visible.
    setRatings([]);
    setLoadedHandle("");
    setPartial(false);
    // A failed page keeps the ratings already fetched, so the list is offered as it stands and
    // only flagged as unfinished.
    void loadRatings(handle).then(({ items, complete }) => {
      if (!live) return;
      setRatings(items);
      setLoadedHandle(handle);
      setPartial(!complete);
    });
    return () => {
      live = false;
    };
  }, [active, handle, attempt, sessionRevision]);

  const ready = loadedHandle === handle;
  const options = useMemo(
    () => (token && ready ? rankRatingOptions(ratings, token.query) : []),
    [ratings, token, ready],
  );

  const dismissed = !!token && dismissedAt === token.start;
  // The picker follows the caret while the author is in the ratings list, and steps out of the
  // way while the person search has the focus.
  const open = !!token && !!source && view === "ratings" && !dismissed;
  const visible = !!token && !!source && (view === "people" || !dismissed);
  const current = Math.max(0, Math.min(index, options.length - 1));

  // Typing again puts the author back in the composer, so the person search steps aside.
  const tokenKey = token ? `${token.start}:${token.query}` : "";
  useEffect(() => {
    setView("ratings");
  }, [tokenKey]);

  useEffect(() => {
    setIndex(0);
  }, [token?.query, handle]);

  return {
    token,
    source,
    sources: all,
    options,
    open,
    visible,
    view,
    loading: !!token && !ready && dismissedAt === null,
    /** The walk stopped early, so the list on screen may not hold every rating. */
    incomplete: !!token && ready && partial,
    retry: () => setAttempt((n) => n + 1),
    index: current,
    move: (step: number) =>
      setIndex((i) => (options.length ? (i + step + options.length) % options.length : 0)),
    hover: setIndex,
    cycleSource: (step: number) => {
      if (!all.length) return;
      const at = Math.max(
        0,
        all.findIndex((person) => person.handle === source?.handle),
      );
      setSelected(all[(at + step + all.length) % all.length].handle);
    },
    dismiss: () => setDismissedAt(token?.start ?? null),
    showPeople: () => setView("people"),
    backToRatings: () => setView("ratings"),
    pickPerson: (next: RatingSource) => {
      const key = next.handle.toLowerCase();
      if (!sources.some((person) => person.handle.toLowerCase() === key)) {
        setPicked((prev) => [...prev, next]);
      }
      setSelected(next.handle);
      setView("ratings");
      setIndex(0);
    },
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
  onReturnFocus,
}: {
  suggest: RatingSuggest;
  onPick: (rating: PublicRating) => void;
  /** Hands the caret back to the composer after the person search has had it. */
  onReturnFocus?: () => void;
}) {
  const t = useT();
  if (!suggest.visible) return null;
  return (
    <div
      aria-label={t("Ratings you can quote")}
      data-profile-solid="elevated"
      className="absolute bottom-full start-0 z-30 mb-2 w-full overflow-hidden rounded-[12px] border border-soft bg-elevated shadow-[0_24px_60px_-20px_rgba(0,0,0,0.7)]"
    >
      {suggest.view === "people" ? (
        <PeoplePanel
          sources={suggest.sources}
          activeHandle={suggest.source?.handle ?? ""}
          onPick={(person) => {
            suggest.pickPerson(person);
            onReturnFocus?.();
          }}
          onBack={() => {
            suggest.backToRatings();
            onReturnFocus?.();
          }}
        />
      ) : (
        <>
          <PersonBar source={suggest.source} onOpen={suggest.showPeople} />
          {suggest.loading ? (
            <p className="px-3 py-2.5 text-[12.5px] text-ink-subtle">{t("Loading ratings…")}</p>
          ) : suggest.options.length === 0 ? (
            suggest.incomplete ? null : (
              <p className="px-3 py-2.5 text-[12.5px] text-ink-subtle">
                {suggest.token?.query.trim()
                  ? t('No matches for "{query}"', { query: suggest.token.query.trim() })
                  : t("No ratings to quote from this person.")}
              </p>
            )
          ) : (
            <div
              role="listbox"
              aria-label={t("Ratings you can quote")}
              className="max-h-[260px] overflow-y-auto py-1"
            >
              {suggest.options.map((r, i) => (
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
              ))}
            </div>
          )}
          {suggest.incomplete && (
            <div className="flex items-center justify-between gap-2 border-t border-soft px-2.5 py-1.5">
              <span className="min-w-0 truncate text-[11.5px] text-ink-subtle">
                {t("Some ratings could not be loaded.")}
              </span>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={suggest.retry}
                className="inline-flex shrink-0 items-center gap-1 rounded-full bg-raised px-2.5 py-1 text-[11.5px] font-semibold text-ink-muted transition-colors hover:text-ink"
              >
                <RotateCcw size={11} />
                {t("Retry")}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Who the ratings currently on offer belong to, and the door to the person search. */
function PersonBar({ source, onOpen }: { source: RatingSource | null; onOpen: () => void }) {
  const t = useT();
  if (!source) return null;
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onOpen}
      aria-label={t("Quote a rating from anyone")}
      className="flex w-full items-center gap-2.5 border-b border-soft px-2.5 py-2 text-start transition-colors hover:bg-raised"
    >
      <Avatar
        src={source.avatarUrl}
        size={22}
        online={source.online}
        alias={source.label ?? source.handle}
      />
      <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-ink">
        {sourceLabel(source, t)}
        <span className="font-normal text-ink-subtle"> @{source.handle}</span>
      </span>
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-raised px-2 py-0.5 text-[11px] font-medium text-ink-muted">
        <Users size={11} />
        {t("Switch")}
      </span>
    </button>
  );
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
