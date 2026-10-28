import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { HarborMark } from "@/components/icons/harbor-mark";
import { ModalShell, useModalExit } from "@/components/modal-shell";
import { useT } from "@/lib/i18n";
import { advanceFocus, captureFocusReturn } from "@/lib/keyboard-navigation";
import { X } from "@/views/settings/icons";
import { RecoveryReveal } from "@/views/settings/theme-panel/custom-themes-section/author-account-panel/recovery-reveal";
import { AccountAuthForm } from "./account-auth-form";
import { HarborSocialCover } from "./harbor-social-cover";

const FOCUSABLE =
  'button:not([disabled]), a[href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function HarborAccountDialog({
  onClose,
  returnFocus,
}: {
  onClose: () => void;
  returnFocus?: HTMLElement | null;
}) {
  const t = useT();
  const headingId = useId();
  const contentRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<(() => void) | null>(null);
  const returnFocusRef = useRef(returnFocus);
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { closing, close } = useModalExit(onClose);
  const dismiss = () => {
    if (!busy) close();
  };

  useLayoutEffect(() => {
    restoreFocusRef.current = captureFocusReturn();
  }, []);

  useEffect(() => {
    return () => {
      const target = returnFocusRef.current;
      if (target?.isConnected) advanceFocus(target);
      else restoreFocusRef.current?.();
    };
  }, []);

  useLayoutEffect(() => {
    // RecoveryReveal renders its own portal. Its one-time code must remain
    // mounted even when registration has already notified author subscribers.
    const dialogs = document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]');
    const dialog = recoveryCode
      ? dialogs[dialogs.length - 1]
      : contentRef.current?.closest<HTMLElement>('[role="dialog"]');
    if (!dialog) return;
    const controls = () =>
      Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => {
        if (el.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
        const style = window.getComputedStyle(el);
        return style.display !== "none" && style.visibility !== "hidden";
      });
    const firstButton = controls().find((el) => el.tagName === "BUTTON");
    if (firstButton) advanceFocus(firstButton);
    const isTopDialog = () => {
      const active = document.querySelectorAll('[role="dialog"][aria-modal="true"]');
      return active[active.length - 1] === dialog;
    };
    const onFocus = (event: FocusEvent) => {
      if (isTopDialog() && !dialog.contains(event.target as Node)) {
        const first = controls()[0];
        if (first) advanceFocus(first);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || !isTopDialog()) return;
      const available = controls();
      const first = available[0],
        last = available[available.length - 1];
      if (!first || !last) return;
      if (event.shiftKey ? document.activeElement === first : document.activeElement === last) {
        event.preventDefault();
        advanceFocus(event.shiftKey ? last : first);
      }
    };
    document.addEventListener("focusin", onFocus);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("focusin", onFocus);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [recoveryCode]);

  if (recoveryCode) return <RecoveryReveal code={recoveryCode} onDone={onClose} />;

  return (
    <ModalShell
      closing={closing}
      onDismiss={dismiss}
      dismissOnBackdrop={!busy}
      width={520}
      labelledBy={headingId}
      backdropClassName="bg-black/45 backdrop-blur-sm !p-4 sm:!p-8 [&>div]:rounded-[24px] [&>div]:border [&>div]:border-edge-soft [&>div]:shadow-2xl"
    >
      <div ref={contentRef} className="flex min-h-0 flex-col overflow-y-auto font-sans">
        <div className="flex items-center gap-3 px-6 pt-5">
          <HarborMark className="h-8 w-8 shrink-0 text-ink" />
          <h2
            id={headingId}
            className="flex-1 font-display text-[29px] leading-9 tracking-tight text-ink"
          >
            {t("Harbor account")}
          </h2>
          <button
            type="button"
            onClick={dismiss}
            disabled={busy}
            aria-label={t("Close")}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-ink-muted transition-colors hover:bg-elevated hover:text-ink"
          >
            <X size={18} />
          </button>
        </div>
        <HarborSocialCover active={!closing} />
        <AccountAuthForm
          embedded
          initialMode="signin"
          onSignIn={close}
          onRecovery={setRecoveryCode}
          onBusyChange={setBusy}
        />
      </div>
    </ModalShell>
  );
}
