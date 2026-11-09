import { useId, useState } from "react";
import { Link2, Trash2, X } from "lucide-react";
import { ModalShell, useModalExit } from "@/components/modal-shell";
import { useSectionBack } from "@/lib/section-back";
import { useT } from "@/lib/i18n";
import type { GameDownloadBundle } from "@/lib/games/download-game-groups";
import type { GameTransfer } from "@/lib/games/transfers";
import "./game-source-links.css";
import "./game-downloads.css";

export function GameDownloadGroupRelinkPicker({
  group,
  onChoose,
  onClose,
}: {
  group: GameDownloadBundle;
  onChoose: (record: GameTransfer) => void;
  onClose: () => void;
}) {
  const t = useT(),
    title = useId();
  const { closing, close } = useModalExit(onClose);
  useSectionBack(close, true);
  const files = group.items.flatMap((item) =>
    item.kind === "direct" && ["paused", "failed"].includes(item.record.status)
      ? [item.record]
      : [],
  );
  return (
    <ModalShell
      width={600}
      closing={closing}
      onDismiss={close}
      labelledBy={title}
      backdropClassName="games-source-link-backdrop"
    >
      <div className="games-source-link-dialog games-download-bundle-dialog" inert={closing}>
        <header>
          <div>
            <span className="games-section-kicker">{group.name}</span>
            <h2 id={title}>{t("games.download.relink.title")}</h2>
          </div>
          <button
            className="games-icon-button"
            type="button"
            onClick={close}
            aria-label={t("common.close")}
          >
            <X size={18} />
          </button>
        </header>
        <div className="games-source-link-body">
          <p>{t("games.download.bundle.chooseLink")}</p>
          <div className="games-download-bundle-picker">
            {files.map((record) => (
              <button
                type="button"
                className="games-button"
                key={record.id}
                onClick={() => {
                  close();
                  onChoose(record);
                }}
              >
                <Link2 size={17} />
                <span>{record.name}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </ModalShell>
  );
}

export function GameDownloadGroupDeleteDialog({
  group,
  onConfirm,
  onClose,
}: {
  group: GameDownloadBundle;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const t = useT(),
    title = useId();
  const { closing, close } = useModalExit(onClose);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const active = group.items.some((item) =>
    item.kind === "torrent"
      ? !["paused", "failed", "complete"].includes(item.record.status) ||
        ["checking", "seeding"].includes(item.record.sharing?.status ?? "")
      : !["paused", "failed", "complete", "canceled"].includes(item.record.status),
  );
  const direct = group.items.filter((item) => item.kind === "direct").length;
  const torrents = group.items.length - direct;
  const dismiss = () => {
    if (!busy) close();
  };
  useSectionBack(dismiss, !busy);
  const confirm = async () => {
    if (busy || active) return;
    setBusy(true);
    setError("");
    try {
      await onConfirm();
      close();
    } catch (reason) {
      const detail = String(reason);
      if (detail.includes("games_delete_busy")) setError("games.download.bundle.deleteBusy");
      else if (detail.includes("games_delete_unsafe"))
        setError("games.download.bundle.deleteUnsafe");
      else setError("games.download.bundle.deleteFailed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <ModalShell
      width={640}
      closing={closing}
      onDismiss={dismiss}
      labelledBy={title}
      backdropClassName="games-source-link-backdrop"
    >
      <div className="games-source-link-dialog games-download-bundle-dialog" inert={closing}>
        <header>
          <div>
            <span className="games-section-kicker">{group.name}</span>
            <h2 id={title}>{t("games.download.bundle.confirmDelete")}</h2>
          </div>
          <button
            type="button"
            className="games-icon-button"
            disabled={busy}
            onClick={dismiss}
            aria-label={t("common.close")}
          >
            <X size={18} />
          </button>
        </header>
        <div className="games-source-link-body">
          <p>{t("games.download.bundle.deleteWarning")}</p>
          <p>{t("games.download.bundle.deleteCounts", { files: direct, folders: torrents })}</p>
          <p>{t("games.download.bundle.deleteScope")}</p>
          {active && (
            <p className="games-download-bundle-warning" role="status">
              {t("games.download.bundle.deletePauseFirst")}
            </p>
          )}
          {error && (
            <p role="alert" className="games-download-bundle-warning">
              {t(error)}
            </p>
          )}
        </div>
        <footer>
          <button type="button" className="games-button" disabled={busy} onClick={dismiss}>
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="games-button games-download-bundle-confirm-delete"
            disabled={busy || active}
            onClick={() => void confirm()}
          >
            <Trash2 size={16} />
            {t(busy ? "common.loading" : "games.download.bundle.confirmDelete")}
          </button>
        </footer>
      </div>
    </ModalShell>
  );
}
