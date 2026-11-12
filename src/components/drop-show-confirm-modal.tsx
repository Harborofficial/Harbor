import { Ban, Loader2, X } from "lucide-react";
import { useId, useState, useSyncExternalStore } from "react";
import { ModalShell, useModalExit } from "@/components/modal-shell";
import { useT } from "@/lib/i18n";
import {
  getSession as getPmdbSession,
  subscribeSession as subscribePmdbSession,
} from "@/lib/publicmetadb/session";

export function DropShowConfirmModal({
  title,
  onClose,
  onConfirm,
}: {
  title: string;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  const t = useT();
  const pmdbSession = useSyncExternalStore(subscribePmdbSession, getPmdbSession);
  const titleId = useId();
  const { closing, close } = useModalExit(onClose);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await onConfirm();
      close();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("The show could not be dropped."));
      setBusy(false);
    }
  };

  return (
    <ModalShell
      closing={closing}
      onDismiss={busy ? () => {} : close}
      width={520}
      labelledBy={titleId}
    >
      <div className="flex items-start gap-4 px-6 pt-6">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-danger/10 text-danger">
          <Ban size={17} strokeWidth={2.1} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 id={titleId} className="text-[17px] font-semibold tracking-tight text-ink">
            {t("Drop show?")}
          </h2>
          <p className="text-[12.5px] leading-relaxed text-ink-subtle">
            {t(
              '"{title}" will be removed from Continue Watching and marked Dropped on connected trackers that support it.',
              {
                title,
              },
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={close}
          disabled={busy}
          aria-label={t("Close")}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-ink-subtle transition-colors hover:bg-elevated hover:text-ink disabled:opacity-50"
        >
          <X size={16} />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-6">
        {pmdbSession?.apiKey && (
          <p className="text-[12.5px] leading-relaxed text-ink-subtle">
            {t(
              "PublicMetaDB will mark this show as Dropped, remove it from your PMDB watchlist if present, and clear saved resume progress. Watched episode history is kept.",
            )}
          </p>
        )}
        {error && (
          <p
            role="alert"
            className="whitespace-pre-line rounded-md bg-danger/10 px-3 py-2.5 text-[12px] leading-relaxed text-danger"
          >
            {error}
          </p>
        )}
      </div>

      <div className="flex items-center justify-end gap-2 px-6 pb-6">
        <button
          type="button"
          onClick={close}
          disabled={busy}
          autoFocus
          className="harbor-press-pop h-9 rounded-md bg-elevated px-4 text-[12.5px] font-semibold text-ink-muted transition-colors hover:text-ink disabled:opacity-50"
        >
          {t("Cancel")}
        </button>
        <button
          type="button"
          onClick={() => void confirm()}
          disabled={busy}
          className="harbor-press-pop flex h-9 min-w-[96px] items-center justify-center gap-2 rounded-md bg-danger px-4 text-[12.5px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {busy ? <Loader2 size={15} className="animate-spin" /> : t("Drop show")}
        </button>
      </div>
    </ModalShell>
  );
}
