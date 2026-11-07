import { useId, useSyncExternalStore } from "react";
import { ModalShell } from "@/components/modal-shell";
import {
  getConfirmActionState,
  resolveConfirmAction,
  subscribeConfirmAction,
} from "@/lib/confirm-action";
import { useT } from "@/lib/i18n";

export function ConfirmActionModal() {
  const t = useT();
  const titleId = useId();
  const state = useSyncExternalStore(subscribeConfirmAction, getConfirmActionState);
  if (!state.open) return null;
  return (
    <ModalShell
      closing={false}
      onDismiss={() => resolveConfirmAction(false)}
      width={440}
      labelledBy={titleId}
    >
      <div className="px-6 pt-6">
        <h2 id={titleId} className="text-[17px] font-semibold tracking-tight text-ink">
          {state.title}
        </h2>
        <p className="mt-2 text-[12.5px] leading-relaxed text-ink-subtle">{state.message}</p>
      </div>
      <div className="flex items-center justify-end gap-2 px-6 pb-6 pt-5">
        <button
          type="button"
          autoFocus
          onClick={() => resolveConfirmAction(false)}
          className="harbor-press-pop h-9 rounded-md bg-elevated px-4 text-[12.5px] font-semibold text-ink-muted transition-colors hover:text-ink"
        >
          {t("common.cancel")}
        </button>
        <button
          type="button"
          onClick={() => resolveConfirmAction(true)}
          className={
            state.destructive
              ? "harbor-press-pop h-9 rounded-md bg-danger px-4 text-[12.5px] font-semibold text-white transition-opacity hover:opacity-90"
              : "harbor-press-pop h-9 rounded-md bg-ink px-4 text-[12.5px] font-semibold text-canvas transition-opacity hover:opacity-90"
          }
        >
          {state.confirmLabel}
        </button>
      </div>
    </ModalShell>
  );
}
