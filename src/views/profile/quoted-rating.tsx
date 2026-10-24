import { Eye, Star } from "lucide-react";
import { useState } from "react";
import { Poster } from "@/components/poster";
import { RatingStars } from "@/components/ratings/rating-stars";
import { useT } from "@/lib/i18n";
import { useRatingPoster } from "@/lib/ratings/poster";
import type { RatingQuote } from "@/lib/ratings/quote";
import { MentionLink } from "./mention-link";
import { useProfileTitle } from "./use-profile-title";
import { useQuotedRating } from "./use-quoted-rating";

/** The rating a comment replies to: the poster, the title, its score and the rater's review. */
export function QuotedRating({
  quote,
  onOpenMeta,
  onOpenAuthor,
}: {
  quote: RatingQuote;
  onOpenMeta?: (metaId: string, kind?: string, hint?: { name?: string; poster?: string }) => void;
  onOpenAuthor?: (handle: string) => void;
}) {
  const t = useT();
  const lookup = useQuotedRating(quote);
  const rating = lookup.rating;
  const score = rating?.score ?? quote.score;
  const title = rating?.title ?? "";
  const poster = useRatingPoster(quote.itemKey, quote.mediaType, title, rating?.posterUrl);
  const media = useProfileTitle(quote.itemKey, title, poster, quote.mediaType);
  const [revealed, setRevealed] = useState(false);
  const open = onOpenMeta
    ? () => onOpenMeta(quote.itemKey, quote.mediaType, { name: media.title, poster: media.poster })
    : undefined;
  const label = media.title || (lookup.state === "loading" ? t("Loading rating…") : t("Rating"));

  return (
    <div
      ref={media.ref}
      className="mt-2 rounded-[12px] border border-edge-soft bg-elevated/60 p-2.5"
    >
      <div className="flex gap-3">
        <button
          type="button"
          onClick={open}
          disabled={!open}
          className="w-12 shrink-0 disabled:cursor-default"
        >
          <Poster
            src={media.poster}
            seed={media.title || quote.itemKey}
            ratio="portrait"
            lazy
            className="rounded-[6px] ring-1 ring-edge-soft"
          />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-1 text-[11.5px] text-ink-subtle">
            <MentionLink
              handle={quote.authorHandle}
              label={`@${quote.authorHandle}`}
              onOpen={onOpenAuthor}
            />
            <span>{t("rated")}</span>
          </div>
          <div className="mt-0.5 flex items-center gap-2">
            <button
              type="button"
              onClick={open}
              disabled={!open}
              className="min-w-0 truncate text-start text-[13px] font-semibold text-ink hover:underline disabled:cursor-default disabled:no-underline"
            >
              {label}
            </button>
            <span className="inline-flex shrink-0 items-center gap-0.5 text-[12px] font-bold tabular-nums text-ink">
              <Star size={11} className="fill-current" />
              {score}
            </span>
          </div>
          <div className="mt-1">
            <RatingStars value={score} readOnly size={12} />
          </div>
          {rating?.review && (
            <div className="relative mt-1.5">
              <p
                className={`line-clamp-6 whitespace-pre-line text-[12.5px] leading-relaxed text-ink-muted ${
                  rating.spoiler && !revealed ? "select-none blur-sm" : ""
                }`}
              >
                {rating.review}
              </p>
              {rating.spoiler && !revealed && (
                <button
                  type="button"
                  onClick={() => setRevealed(true)}
                  className="absolute inset-0 flex items-center justify-center gap-1.5 rounded-md bg-canvas/30 text-[12px] font-semibold text-ink transition-colors hover:bg-canvas/10"
                >
                  <Eye size={13} />
                  {t("Show spoiler")}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
