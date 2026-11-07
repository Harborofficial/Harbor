import { useEffect, useRef, useState, type ReactNode } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { useT } from "@/lib/i18n";
import {
  cachedGameCollectionCover,
  clearGameCollectionCover,
  gameCollectionCoverEvent,
  readGameCollectionCover,
  saveGameCollectionCover,
} from "@/lib/games/collection-cover";

export function useGameCollectionCover(collectionId: string): string {
  const [state, setState] = useState(() => ({
    id: collectionId,
    cover: cachedGameCollectionCover(collectionId) ?? "",
  }));
  const cover =
    state.id === collectionId ? state.cover : (cachedGameCollectionCover(collectionId) ?? "");
  useEffect(() => {
    let alive = true;
    const setCover = (next: string) => {
      if (alive) setState({ id: collectionId, cover: next });
    };
    setCover(cachedGameCollectionCover(collectionId) ?? "");
    const pull = () => {
      if (!collectionId) {
        setCover("");
        return;
      }
      void readGameCollectionCover(collectionId).then(setCover);
    };
    pull();
    const onChange = (event: Event) => {
      if ((event as CustomEvent<string>).detail === collectionId) pull();
    };
    window.addEventListener(gameCollectionCoverEvent(), onChange);
    return () => {
      alive = false;
      window.removeEventListener(gameCollectionCoverEvent(), onChange);
    };
  }, [collectionId]);
  return cover;
}

export function GameCollectionCoverEdit({
  collectionId,
  children,
}: {
  collectionId: string;
  children: ReactNode;
}) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState("");
  const cover = useGameCollectionCover(collectionId);

  const pick = (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setFailed("");
    void saveGameCollectionCover(collectionId, file)
      .catch((cause: unknown) => setFailed(cause instanceof Error ? cause.message : "error"))
      .finally(() => setBusy(false));
  };
  const openPicker = () => {
    if (!busy) input.current?.click();
  };

  return (
    <div
      className="games-personal-cover-edit"
      role="button"
      tabIndex={0}
      aria-label={t("games.collections.coverUpload")}
      title={t("games.collections.coverUpload")}
      onClick={openPicker}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        openPicker();
      }}
    >
      {children}
      <div className="games-personal-cover-actions">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            openPicker();
          }}
          disabled={busy}
          aria-label={t("games.collections.coverUpload")}
          title={t("games.collections.coverUpload")}
        >
          {busy ? (
            <Loader2 size={16} className="animate-spin motion-reduce:animate-none" />
          ) : (
            <Plus size={16} aria-hidden />
          )}
        </button>
        {cover && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              void clearGameCollectionCover(collectionId);
            }}
            disabled={busy}
            aria-label={t("games.collections.coverRemove")}
            title={t("games.collections.coverRemove")}
          >
            <Trash2 size={16} aria-hidden />
          </button>
        )}
      </div>
      {failed && (
        <p role="alert" className="games-personal-cover-error">
          {t(failed)}
        </p>
      )}
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
        hidden
        onChange={(event) => {
          pick(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
    </div>
  );
}
