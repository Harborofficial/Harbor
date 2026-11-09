import { useRef, useState } from "react";
import {
  Bold,
  Clapperboard,
  Eye,
  Image as ImageIcon,
  Link2,
  Loader2,
  Pencil,
  Send,
  Youtube,
} from "lucide-react";
import { useT } from "@/lib/i18n";
import { useAutosize } from "@/lib/use-autosize";
import {
  composeQuotedBody,
  ratingQuoteFrom,
  ratingQuoteLength,
  type RatingQuote,
} from "@/lib/ratings/quote";
import { withoutRatingToken } from "@/lib/ratings/trigger";
import type { PublicRating } from "@/lib/ratings/types";
import { createGroupPost, type GroupPost } from "@/lib/social/group-posts";
import {
  QuoteChip,
  RatingPicker,
  ratingPickerKey,
  useRatingSources,
  useRatingSuggest,
} from "@/views/profile/rating-picker";
import { EmbedPrompt, type EmbedKind } from "@/components/embed-prompt";
import { MediaPicker } from "./media-picker";
import { PostBody } from "./post-body";
import { Avatar } from "@/views/profile/profile-bits";

const MAX = 2000;

const TOOLS = [
  { icon: Bold, label: "Bold", wrap: ["[b]", "[/b]"] as const },
  { icon: Link2, label: "Link", wrap: ["[url=https://]", "[/url]"] as const },
  { icon: ImageIcon, label: "Image", embed: "img" as EmbedKind },
  { icon: Youtube, label: "YouTube", embed: "youtube" as EmbedKind },
  { icon: Clapperboard, label: "Link a title", media: true },
];

export function PostCompose({
  groupId,
  groupName,
  meAvatar,
  meAlias,
  onPosted,
}: {
  groupId: string;
  groupName: string;
  meAvatar?: string;
  meAlias?: string;
  onPosted: (p: GroupPost) => void;
}) {
  const t = useT();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const [embed, setEmbed] = useState<EmbedKind | null>(null);
  const [picking, setPicking] = useState(false);
  const [preview, setPreview] = useState(false);
  const [quote, setQuote] = useState<RatingQuote | null>(null);
  const [caret, setCaret] = useState(0);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const trimmed = body.trim();
  const left = MAX - body.length - (quote ? ratingQuoteLength(quote) : 0);
  const sources = useRatingSources();
  const suggest = useRatingSuggest(body, caret, sources);
  useAutosize(boxRef, body);
  const active = focused || !!trimmed || busy || !!embed || picking;

  const splice = (start: number, end: number, text: string) => {
    setBody((b) => (b.slice(0, start) + text + b.slice(end)).slice(0, MAX));
    requestAnimationFrame(() => {
      boxRef.current?.focus();
      const pos = start + text.length;
      boxRef.current?.setSelectionRange(pos, pos);
    });
  };

  const insertEmbed = (bbcode: string) => {
    const at = Math.min(caret, body.length);
    const pad = at > 0 && body[at - 1] !== "\n" ? "\n" : "";
    splice(at, at, `${pad}${bbcode}\n`);
  };

  // The person search borrows the caret, so it hands it back the same way picking does.
  const restoreFocus = () => {
    const el = boxRef.current;
    if (!el) return;
    el.focus();
    const pos = Math.min(caret, body.length);
    el.setSelectionRange(pos, pos);
  };

  const pickRating = (rating: PublicRating) => {
    const source = suggest.source;
    if (!suggest.token || !source) return;
    const next = withoutRatingToken(body, caret, suggest.token.start);
    setBody(next.text);
    setCaret(next.caret);
    setQuote(ratingQuoteFrom(rating, source.handle));
    requestAnimationFrame(() => {
      boxRef.current?.focus();
      boxRef.current?.setSelectionRange(next.caret, next.caret);
    });
  };

  const send = async () => {
    if (!trimmed || busy || left < 0) return;
    setBusy(true);
    setError(null);
    try {
      onPosted(await createGroupPost(groupId, quote ? composeQuotedBody(quote, trimmed) : trimmed));
      setBody("");
      setQuote(null);
    } catch (e) {
      setError((e as Error).message || t("Could not post."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex gap-3 rounded-lg bg-surface p-3.5 ring-1 ring-edge-soft transition-shadow focus-within:ring-edge">
      <Avatar src={meAvatar} size={38} alias={meAlias} />
      <div className="relative flex min-w-0 flex-1 flex-col gap-2.5">
        <RatingPicker suggest={suggest} onPick={pickRating} onReturnFocus={restoreFocus} />
        {quote && <QuoteChip quote={quote} onRemove={() => setQuote(null)} />}
        <textarea
          ref={boxRef}
          value={body}
          maxLength={MAX}
          onChange={(e) => {
            setBody(e.target.value);
            setCaret(e.target.selectionStart ?? e.target.value.length);
          }}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => {
            if (ratingPickerKey(e, suggest, pickRating)) return;
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void send();
          }}
          rows={1}
          placeholder={t("Share something with {group}. Type # to quote a rating.", {
            group: groupName,
          })}
          className={`harbor-scroll min-h-[38px] w-full resize-none bg-transparent py-1.5 text-[14px] leading-relaxed text-ink outline-none placeholder:text-ink-subtle ${preview ? "hidden" : ""}`}
        />
        {preview && (
          <div className="min-h-[38px] py-1.5">
            {trimmed ? (
              <PostBody body={body} />
            ) : (
              <span className="text-[13px] text-ink-subtle">{t("Nothing to preview yet.")}</span>
            )}
          </div>
        )}
        {active && (
          <div className="flex items-center gap-0.5">
            {TOOLS.map((tool) => (
              <button
                key={tool.label}
                type="button"
                title={t(tool.label)}
                aria-label={t(tool.label)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  const el = boxRef.current;
                  setCaret(el?.selectionStart ?? body.length);
                  if (tool.media) {
                    setPicking(true);
                    return;
                  }
                  if (tool.embed) {
                    setEmbed(tool.embed);
                    return;
                  }
                  if (!el || !tool.wrap) return;
                  const sel = body.slice(el.selectionStart, el.selectionEnd);
                  splice(el.selectionStart, el.selectionEnd, tool.wrap[0] + sel + tool.wrap[1]);
                }}
                className="grid h-8 w-8 place-items-center rounded-sm text-ink-subtle transition-colors hover:bg-elevated hover:text-ink active:scale-90 motion-reduce:active:scale-100"
              >
                <tool.icon size={15} strokeWidth={2.1} />
              </button>
            ))}
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setPreview((v) => !v)}
              title={preview ? t("Edit") : t("Preview")}
              className="ms-auto flex h-8 items-center gap-1.5 rounded-sm px-2.5 text-[12px] font-semibold text-ink-subtle transition-colors hover:bg-elevated hover:text-ink"
            >
              {preview ? <Pencil size={13} /> : <Eye size={14} />}{" "}
              {preview ? t("Edit") : t("Preview")}
            </button>
          </div>
        )}
        {embed && (
          <EmbedPrompt kind={embed} onInsert={insertEmbed} onClose={() => setEmbed(null)} />
        )}
        {picking && <MediaPicker onInsert={insertEmbed} onClose={() => setPicking(false)} />}
        {error && <p className="text-[12.5px] text-danger">{error}</p>}
        {(trimmed || busy) && (
          <div className="flex items-center justify-end gap-3">
            <span className="me-auto text-[11.5px] text-ink-subtle">
              {t("BBCode works: [b] [url] [img] [youtube] [video] [quote]")}
            </span>
            <span
              className={`text-[11.5px] tabular-nums ${left < 100 ? "text-danger" : "text-ink-subtle"}`}
            >
              {left}
            </span>
            <button
              type="button"
              onClick={() => void send()}
              disabled={!trimmed || busy || left < 0}
              className="flex h-9 items-center gap-2 rounded-full bg-ink px-4 text-[12.5px] font-semibold text-canvas transition-[opacity,transform] hover:opacity-90 active:scale-[0.97] disabled:opacity-40"
            >
              {busy ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Send size={13} strokeWidth={2.4} />
              )}
              {t("Post")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
