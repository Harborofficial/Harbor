import { Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n";
import { useAutosize } from "@/lib/use-autosize";
import { ratingQuoteFrom, ratingQuoteLength, type RatingQuote } from "@/lib/ratings/quote";
import { withoutRatingToken, type RatingSource } from "@/lib/ratings/trigger";
import type { PublicRating } from "@/lib/ratings/types";
import { MAX_MENTIONS, scanMentions } from "@/lib/social/mentions";
import type { Friend } from "@/lib/social/friends";
import { MentionPicker, useMentionSuggest } from "./mention-picker";
import { QuoteChip, RatingPicker, ratingPickerKey, useRatingSuggest } from "./rating-picker";

const NO_SOURCES: RatingSource[] = [];
import { COMMENT_MAX, type ComposeIssue } from "./text-safety";

const ISSUE_TEXT: Record<Exclude<ComposeIssue, null>, string> = {
  empty: "Say something first",
  url: "Links are not allowed in comments",
  spam: "That looks like spam, try rephrasing",
  "too-long": `Keep it under ${COMMENT_MAX} characters`,
  cooldown: "Slow down a moment before posting again",
  failed: "Couldn't post right now, try again",
  signin: "Sign in to comment",
};

export function CommentCompose({
  onSubmit,
  sending,
  disabled,
  autoFocus = false,
  quote = null,
  onQuoteChange,
  focusSignal = 0,
  sources = NO_SOURCES,
}: {
  onSubmit: (raw: string, parentId?: string, quote?: RatingQuote | null) => Promise<ComposeIssue>;
  sending: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  quote?: RatingQuote | null;
  onQuoteChange?: (quote: RatingQuote | null) => void;
  focusSignal?: number;
  /** Whose ratings typing "#" offers: the profile owner, you, and your friends. */
  sources?: RatingSource[];
}) {
  const t = useT();
  const [text, setText] = useState("");
  const [caret, setCaret] = useState(0);
  const [issue, setIssue] = useState<ComposeIssue>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const remaining = COMMENT_MAX - text.length - (quote ? ratingQuoteLength(quote) : 0);
  const overCap = scanMentions(text).ignored.length > 0;
  const suggest = useMentionSuggest(text, caret);
  const ratingSuggest = useRatingSuggest(text, caret, onQuoteChange ? sources : NO_SOURCES);
  useAutosize(boxRef, text);

  useEffect(() => {
    if (!focusSignal) return;
    boxRef.current?.focus();
  }, [focusSignal]);

  const send = async () => {
    if (sending) return;
    const result = await onSubmit(text, undefined, quote);
    setIssue(result);
    if (!result) {
      setText("");
      onQuoteChange?.(null);
    }
  };

  const pick = (friend: Friend) => {
    if (!suggest.token) return;
    const { start } = suggest.token;
    setText(`${text.slice(0, start)}@${friend.handle} ${text.slice(caret)}`);
    const pos = start + friend.handle.length + 2;
    setCaret(pos);
    requestAnimationFrame(() => {
      boxRef.current?.focus();
      boxRef.current?.setSelectionRange(pos, pos);
    });
  };

  // The person search borrows the caret, so it hands it back the same way picking does.
  const restoreFocus = () => {
    const el = boxRef.current;
    if (!el) return;
    el.focus();
    const pos = Math.min(caret, text.length);
    el.setSelectionRange(pos, pos);
  };

  // Picking a rating drops the "#query" and shows the rating as the composer's quote instead.
  const pickRating = (rating: PublicRating) => {
    const source = ratingSuggest.source;
    if (!ratingSuggest.token || !source) return;
    const next = withoutRatingToken(text, caret, ratingSuggest.token.start);
    setText(next.text);
    setCaret(next.caret);
    onQuoteChange?.(ratingQuoteFrom(rating, source.handle));
    requestAnimationFrame(() => {
      boxRef.current?.focus();
      boxRef.current?.setSelectionRange(next.caret, next.caret);
    });
  };

  if (disabled) {
    return (
      <div className="rounded-md border border-dashed border-edge px-4 py-3 text-center text-[13px] text-ink-subtle">
        {t("Sign in to leave a comment")}
      </div>
    );
  }

  return (
    <div className="relative rounded-md bg-elevated p-2 ring-1 ring-edge-soft focus-within:ring-edge">
      <MentionPicker suggest={suggest} onPick={pick} />
      <RatingPicker suggest={ratingSuggest} onPick={pickRating} onReturnFocus={restoreFocus} />
      {quote && <QuoteChip quote={quote} onRemove={() => onQuoteChange?.(null)} />}
      <textarea
        ref={boxRef}
        autoFocus={autoFocus}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setCaret(e.target.selectionStart ?? e.target.value.length);
          if (issue) setIssue(null);
        }}
        onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            void send();
            return;
          }
          if (ratingPickerKey(e, ratingSuggest, pickRating)) return;
          if (!suggest.open) return;
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            suggest.move(e.key === "ArrowDown" ? 1 : -1);
          } else if (e.key === "Enter" || e.key === "Tab") {
            e.preventDefault();
            pick(suggest.options[suggest.index]);
          } else if (e.key === "Escape") {
            e.stopPropagation();
            suggest.dismiss();
          }
        }}
        rows={1}
        maxLength={COMMENT_MAX + 40}
        aria-autocomplete="list"
        aria-expanded={suggest.open}
        placeholder={t("Leave a comment. No links. Type # to quote a rating.")}
        className="harbor-scroll min-h-[52px] w-full resize-none bg-transparent px-2 py-1.5 text-[14px] leading-relaxed text-ink outline-none placeholder:text-ink-subtle"
      />
      <div className="flex items-center justify-between gap-3 px-2 pb-1">
        <span className="text-[12px] text-ink-subtle">
          {issue ? (
            <span className="text-danger">{t(ISSUE_TEXT[issue])}</span>
          ) : overCap ? (
            <span className="text-amber-300">
              {t("Only the first {max} people you mention get notified.", { max: MAX_MENTIONS })}
            </span>
          ) : (
            t("{count} left", { count: remaining })
          )}
        </span>
        <button
          onClick={() => void send()}
          disabled={sending || !text.trim()}
          className="inline-flex min-h-11 items-center gap-2 rounded-md bg-accent px-4 text-[14px] font-semibold text-canvas transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          <Send size={20} /> {sending ? t("Posting") : t("Post")}
        </button>
      </div>
    </div>
  );
}
