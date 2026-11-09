import { useId, useState, type FormEvent } from "react";
import { Link, LoaderCircle, RefreshCw, Unlink } from "lucide-react";
import { ModalShell, useModalExit } from "@/components/modal-shell";
import { confirmAction } from "@/lib/confirm-action";
import { useT } from "@/lib/i18n";
import {
  importLinkedMusicPlaylist,
  syncLinkedMusicPlaylist,
  unlinkMusicPlaylist,
} from "@/lib/music/library";
import { parseYouTubePlaylistLink } from "@/lib/music/youtube-playlist-link";
import type { MusicPlaylist } from "@/lib/music/types";

export function MusicPlaylistLinkDialog({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: (playlist: MusicPlaylist) => void;
}) {
  const t = useT();
  const titleId = useId();
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { closing, close } = useModalExit(onClose);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!link.trim() || busy || closing) return;
    setError("");
    try {
      const id = parseYouTubePlaylistLink(link);
      setBusy(true);
      const playlist = await importLinkedMusicPlaylist(id);
      onImported(playlist);
      close();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell
      closing={closing}
      onDismiss={() => {
        if (!busy) close();
      }}
      width={500}
      labelledBy={titleId}
    >
      <form className="flex flex-col gap-4 p-5" onSubmit={(event) => void submit(event)}>
        <h2 id={titleId} className="text-lg font-semibold text-ink">
          {t("music.linked.import")}
        </h2>
        <p className="text-sm text-ink-muted">{t("music.linked.importHelp")}</p>
        <input
          autoFocus
          value={link}
          onChange={(event) => setLink(event.target.value)}
          maxLength={2048}
          disabled={busy}
          spellCheck={false}
          aria-label={t("music.linked.linkLabel")}
          placeholder={t("music.linked.linkLabel")}
          className="min-h-11 w-full rounded-md bg-elevated px-3 py-2 text-[15px] text-ink outline-none placeholder:text-ink-subtle focus-visible:outline-2 focus-visible:outline-accent"
        />
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        {busy && (
          <p role="status" className="text-sm text-ink-muted">
            {t("music.linked.loading")}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className="music-library-text" disabled={busy} onClick={close}>
            {t("common.cancel")}
          </button>
          <button
            type="submit"
            className="music-library-button"
            disabled={busy || !link.trim()}
            aria-busy={busy}
          >
            {busy ? (
              <LoaderCircle size={17} className="animate-spin motion-reduce:animate-none" />
            ) : (
              <Link size={17} />
            )}
            {t("music.linked.import")}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

export function MusicPlaylistLinkActions({
  playlist,
  onUpdated,
  disabled = false,
}: {
  playlist: MusicPlaylist;
  onUpdated: (playlist: MusicPlaylist) => void;
  disabled?: boolean;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  if (!playlist.source) return null;
  const isMix =
    playlist.source.connectorId === "youtube" &&
    playlist.source.sourceId.startsWith("RD") &&
    playlist.source.sourceId.includes(":");
  const run = async (sync: boolean) => {
    if (busy || disabled) return;
    const confirmed = await confirmAction({
      title: t(
        sync
          ? isMix
            ? "music.linked.mixSyncTitle"
            : "music.linked.syncTitle"
          : "music.linked.unlinkTitle",
      ),
      message: t(
        sync
          ? isMix
            ? "music.linked.mixSyncConfirm"
            : "music.linked.syncConfirm"
          : "music.linked.unlinkConfirm",
      ),
      confirmLabel: t(sync ? "music.linked.sync" : "music.linked.unlink"),
    });
    if (!confirmed) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const updated = await (sync
        ? syncLinkedMusicPlaylist(playlist.id)
        : unlinkMusicPlaylist(playlist.id));
      onUpdated(updated);
      if (sync) setNotice(t("music.linked.syncedNotice", { count: updated.tracks.length }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-3 flex flex-col gap-2">
      <span className="flex items-center gap-2 text-sm text-ink-muted">
        <Link size={15} />
        {t("music.linked.source")}
      </span>
      <small className="text-ink-subtle">
        {t("music.linked.lastSynced", {
          date: new Date(Number(playlist.source.syncedAt)).toLocaleString(),
        })}
      </small>
      <p className="text-sm text-ink-muted">
        {t(isMix ? "music.linked.mixHelp" : "music.linked.mirrorHelp")}
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="music-library-button"
          disabled={busy || disabled}
          aria-busy={busy}
          onClick={() => void run(true)}
        >
          {busy ? (
            <LoaderCircle size={16} className="animate-spin motion-reduce:animate-none" />
          ) : (
            <RefreshCw size={16} />
          )}
          {t("music.linked.sync")}
        </button>
        <button
          type="button"
          className="music-library-text"
          disabled={busy || disabled}
          onClick={() => void run(false)}
        >
          <Unlink size={16} />
          {t("music.linked.unlink")}
        </button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm text-ink-muted">
          {notice}
        </p>
      )}
    </div>
  );
}
