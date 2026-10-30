import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/lib/i18n";

export function QueueClearConfirm({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const t = useT();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    dialog.showModal();
    cancelRef.current?.focus();

    return () => {
      if (dialog.open) dialog.close();
    };
  }, []);

  return createPortal(
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      className="queue-clear-confirm m-auto w-[min(26rem,calc(100vw-2rem))] rounded-2xl border border-edge bg-canvas p-5 text-ink shadow-2xl"
    >
      <h2 id={titleId} className="text-lg font-semibold">
        {t("Clear your queue?")}
      </h2>

      <p id={descriptionId} className="mt-2 text-sm leading-relaxed text-ink-subtle">
        {t("All items will be removed from your queue. Downloaded files will not be deleted.")}
      </p>

      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <button
          ref={cancelRef}
          type="button"
          onClick={onCancel}
          className="min-h-10 rounded-xl bg-raised px-4 py-2 text-sm font-medium hover:bg-elevated focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          {t("Cancel")}
        </button>

        <button
          type="button"
          onClick={onConfirm}
          className="min-h-10 rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          {t("Clear your queue")}
        </button>
      </div>
    </dialog>,
    document.body,
  );
}
