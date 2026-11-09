import { useCallback, useMemo, useState } from "react";
import { Languages, Loader2 } from "lucide-react";
import { aiIsGroq, aiKey } from "@/lib/ai-models";
import { getUiLanguage, LANGUAGES, useT, type UiLanguage } from "@/lib/i18n";
import { translateReviews, type ReviewTranslationAi } from "@/lib/review-translation";
import { useSettings } from "@/lib/settings";

const TARGET_KEY = "harbor.reviews.translate-to.v1";

function savedTarget(): UiLanguage {
  try {
    const saved = localStorage.getItem(TARGET_KEY);
    if (LANGUAGES.some(({ code }) => code === saved)) return saved as UiLanguage;
  } catch {
    /* Storage can be unavailable; the app language is the default. */
  }
  return getUiLanguage();
}

export type ReviewTranslator = {
  target: UiLanguage;
  setTarget: (target: UiLanguage) => void;
  /** The translation while it is shown, otherwise the original text. */
  display: (text: string) => string;
  isShown: (text: string) => boolean;
  isBusy: (text: string) => boolean;
  /** The last attempt to translate this text failed; it can be tried again. */
  isFailed: (text: string) => boolean;
  /** Shows or hides the translation of a review; `extra` (its title) follows the review. */
  toggle: (text: string, extra?: string[]) => void;
  translateAll: (texts: string[], failureGroups?: string[][]) => void;
  busyAll: boolean;
  /** How many reviews the last "Translate all" could not translate. */
  failedAll: number;
};

/** Per-section translation state: which reviews show a translation, and into which language. */
export function useReviewTranslator(): ReviewTranslator {
  const { settings } = useSettings();
  const [target, setTargetState] = useState<UiLanguage>(savedTarget);
  const [translated, setTranslated] = useState<Record<string, string>>({});
  const [shown, setShown] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState<Set<string>>(() => new Set());
  const [failed, setFailed] = useState<Set<string>>(() => new Set());
  const [busyAll, setBusyAll] = useState(false);
  const [failedAll, setFailedAll] = useState(0);

  const ai = useMemo<ReviewTranslationAi | null>(() => {
    const key = aiKey(settings);
    return key.trim() ? { key, model: settings.aiSearchModel, groq: aiIsGroq(settings) } : null;
  }, [settings]);

  const slot = useCallback((text: string) => `${target}\u0000${text}`, [target]);

  /** Translates the texts and shows them; resolves to the strings that could not be translated. */
  const run = useCallback(
    async (texts: string[]): Promise<string[]> => {
      const pending = texts.filter((text) => text.trim() && !translated[slot(text)]);
      let failures: string[] = [];
      if (pending.length) {
        setBusy((prev) => new Set([...prev, ...pending.map(slot)]));
        try {
          const result = await translateReviews(pending, target, ai);
          failures = pending.filter((_, i) => !result[i]);
          setTranslated((prev) => {
            const next = { ...prev };
            pending.forEach((text, i) => {
              if (result[i]) next[slot(text)] = result[i]!;
            });
            return next;
          });
        } catch {
          failures = pending;
        } finally {
          setBusy((prev) => {
            const next = new Set(prev);
            pending.forEach((text) => next.delete(slot(text)));
            return next;
          });
        }
        setFailed((prev) => {
          const next = new Set(prev);
          pending.forEach((text) => next.delete(slot(text)));
          failures.forEach((text) => next.add(slot(text)));
          return next;
        });
      }
      setShown((prev) => new Set([...prev, ...texts.map(slot)]));
      return failures;
    },
    [ai, slot, target, translated],
  );

  return {
    target,
    setTarget: (next) => {
      setTargetState(next);
      try {
        localStorage.setItem(TARGET_KEY, next);
      } catch {
        /* The choice still applies for this session. */
      }
    },
    display: (text) => (shown.has(slot(text)) && translated[slot(text)]) || text,
    isShown: (text) => shown.has(slot(text)) && !!translated[slot(text)],
    isBusy: (text) => busy.has(slot(text)),
    isFailed: (text) => failed.has(slot(text)) && !translated[slot(text)],
    toggle: (text, extra = []) => {
      const texts = [text, ...extra.filter((e) => e.trim())];
      if (shown.has(slot(text)) && translated[slot(text)]) {
        setShown((prev) => {
          const next = new Set(prev);
          texts.forEach((e) => next.delete(slot(e)));
          return next;
        });
      } else void run(texts);
    },
    translateAll: (texts, failureGroups) => {
      if (busyAll) return;
      setBusyAll(true);
      setFailedAll(0);
      void run(texts)
        .then((failures) => {
          if (!failureGroups) {
            setFailedAll(failures.length);
            return;
          }
          const failed = new Set(failures);
          setFailedAll(failureGroups.filter((group) => group.some((text) => failed.has(text))).length);
        })
        .finally(() => setBusyAll(false));
    },
    busyAll,
    failedAll,
  };
}

/** Target language picker and "Translate all" for a list of reviews. */
export function ReviewTranslateBar({
  tr,
  texts,
  failureGroups,
}: {
  tr: ReviewTranslator;
  texts: string[];
  failureGroups?: string[][];
}) {
  const t = useT();
  if (!texts.length) return null;
  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      {tr.failedAll > 0 && !tr.busyAll && (
        <span role="status" className="text-[11.5px] text-danger">
          {t("{n} reviews couldn't be translated. Try again.", { n: tr.failedAll })}
        </span>
      )}
      <select
        value={tr.target}
        onChange={(e) => tr.setTarget(e.target.value as UiLanguage)}
        aria-label={t("Translate reviews to")}
        className="h-7 rounded-full bg-white/[0.06] px-2.5 text-[12px] text-ink-muted outline-none transition-colors hover:bg-white/[0.10] hover:text-ink"
      >
        {LANGUAGES.map(({ code, nativeLabel }) => (
          <option key={code} value={code}>
            {nativeLabel}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => tr.translateAll(texts, failureGroups)}
        disabled={tr.busyAll}
        className="flex h-7 items-center gap-1.5 rounded-full bg-amber-300/15 px-3 text-[12px] font-semibold text-amber-300 transition-colors hover:bg-amber-300/25 disabled:opacity-60"
      >
        {tr.busyAll ? <Loader2 size={12} className="animate-spin" /> : <Languages size={12} />}
        {t("Translate all")}
      </button>
    </div>
  );
}

/** "Translate" / "Show original" for one review. */
export function ReviewTranslateButton({
  tr,
  text,
  extra,
}: {
  tr: ReviewTranslator;
  text: string;
  extra?: string[];
}) {
  const t = useT();
  if (!text.trim()) return null;
  return (
    <button
      type="button"
      onClick={() => tr.toggle(text, extra)}
      disabled={tr.isBusy(text)}
      className="flex shrink-0 items-center gap-1 text-[11.5px] font-semibold text-amber-300/80 transition-colors hover:text-amber-300 disabled:opacity-60"
    >
      {tr.isBusy(text) ? <Loader2 size={11} className="animate-spin" /> : <Languages size={11} />}
      {tr.isShown(text)
        ? t("Show original")
        : tr.isFailed(text)
          ? t("Couldn't translate. Try again")
          : t("Translate")}
    </button>
  );
}
