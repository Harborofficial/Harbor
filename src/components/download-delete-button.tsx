import { useId, useRef, useState, type ReactNode } from "react";
import { Trash2 } from "lucide-react";
import { ModalShell, useModalExit } from "@/components/modal-shell";
import {
  executeContextAction,
  findAction,
  type ActionConfirmation,
  type ActionSource,
} from "@/lib/context-actions";
import { useT } from "@/lib/i18n";

export function DownloadDeleteButton({
  source,
  actionId,
  className,
  children,
}: {
  source: ActionSource;
  actionId: string;
  className?: string;
  children: ReactNode;
}) {
  const [confirmation, setConfirmation] = useState<ActionConfirmation | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const action = findAction(source.actions(), actionId);
  return (
    <span
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <button
        ref={trigger}
        type="button"
        className={className}
        aria-label={action?.label}
        aria-haspopup="dialog"
        disabled={!action?.confirmation || action.disabled || !!confirmation}
        onClick={() => setConfirmation(action?.confirmation ?? null)}
      >
        {children}
      </button>
      {confirmation && (
        <DeleteDialog
          source={source}
          actionId={actionId}
          confirmation={confirmation}
          onClose={() => {
            setConfirmation(null);
            requestAnimationFrame(() => trigger.current?.focus({ preventScroll: true }));
          }}
        />
      )}
    </span>
  );
}

function DeleteDialog({
  source,
  actionId,
  confirmation,
  onClose,
}: {
  source: ActionSource;
  actionId: string;
  confirmation: ActionConfirmation;
  onClose: () => void;
}) {
  const t = useT();
  const titleId = useId();
  const { closing, close } = useModalExit(onClose);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const cancel = useRef<HTMLButtonElement>(null);
  const confirm = useRef<HTMLButtonElement>(null);
  const submit = async () => {
    if (inFlight.current || closing) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      await executeContextAction(source, actionId, { confirmationKey: confirmation.key });
      close();
    } catch (cause) {
      setError(cause instanceof Error ? t(cause.message) : t("The action could not be completed."));
      inFlight.current = false;
      setBusy(false);
    }
  };
  return (
    <ModalShell
      width={480}
      labelledBy={titleId}
      closing={closing}
      onDismiss={() => {
        if (!inFlight.current) close();
      }}
    >
      <div
        className="flex min-h-0 flex-col gap-5 p-6"
        onKeyDown={(event) => {
          if ((event.key === "Enter" || event.key === " ") && event.repeat) event.preventDefault();
          if (event.key === "Tab") {
            event.preventDefault();
            (event.target === cancel.current && !busy ? confirm.current : cancel.current)?.focus();
          }
        }}
      >
        <div className="flex items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-md bg-danger/10 text-danger">
            <Trash2 size={18} />
          </span>
          <h2 id={titleId} className="text-[17px] font-semibold text-ink">
            {confirmation.title}
          </h2>
        </div>
        <p className="max-h-[45vh] overflow-y-auto whitespace-pre-wrap break-words text-[13px] leading-relaxed text-ink-muted">
          {confirmation.description}
        </p>
        {error && (
          <p
            role="alert"
            className="whitespace-pre-wrap break-words rounded-md bg-danger/10 p-3 text-[12px] text-danger"
          >
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button
            ref={cancel}
            type="button"
            autoFocus
            aria-disabled={busy || closing}
            onClick={() => {
              if (!inFlight.current) close();
            }}
            className="harbor-press-pop h-9 rounded-md bg-elevated px-4 text-[12.5px] font-semibold text-ink-muted"
          >
            {t("Cancel")}
          </button>
          <button
            ref={confirm}
            type="button"
            disabled={busy || closing}
            aria-busy={busy}
            onClick={() => void submit()}
            className="harbor-press-pop h-9 rounded-md bg-danger px-4 text-[12.5px] font-semibold text-white disabled:opacity-50"
          >
            {busy ? (confirmation.pendingLabel ?? t("Working…")) : confirmation.confirmLabel}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
