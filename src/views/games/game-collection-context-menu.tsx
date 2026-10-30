import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FolderOpen, Pencil, Pin, PinOff } from "lucide-react";
import { useT } from "@/lib/i18n";
import { menuPosition } from "@/lib/games/library-management";
import type { PersonalGameCollection } from "@/lib/games/personal-collections";
import type { PersonalGameCollectionsState } from "@/hooks/use-personal-game-collections";
import "./game-library-context-menu.css";

export function CollectionContextMenu({
  collection,
  state,
  x,
  y,
  onOpen,
  onEdit,
  close,
}: {
  collection: PersonalGameCollection;
  state: PersonalGameCollectionsState;
  x: number;
  y: number;
  onOpen?: () => void;
  onEdit?: () => void;
  close: () => void;
}) {
  const t = useT();
  const root = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    const box = root.current?.getBoundingClientRect();
    if (box) setPosition(menuPosition(x, y, box.width, box.height, innerWidth, innerHeight));
  }, [x, y]);
  useEffect(() => {
    const frame = requestAnimationFrame(() =>
      root.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true }),
    );
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) close();
    };
    document.addEventListener("pointerdown", outside, true);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", outside, true);
    };
  }, [close]);
  const pinned = collection.pinned;
  return createPortal(
    <div
      ref={root}
      className="g-library-context g-collection-context"
      style={position}
      role="menu"
      aria-label={collection.name}
      data-dropdown-menu
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        close();
      }}
    >
      {onOpen && (
        <button
          role="menuitem"
          onClick={() => {
            onOpen();
            close();
          }}
        >
          <FolderOpen size={18} />
          <span>{t("games.collections.open")}</span>
        </button>
      )}
      {onEdit && (
        <button
          role="menuitem"
          onClick={() => {
            onEdit();
            close();
          }}
        >
          <Pencil size={18} />
          <span>{t("games.collections.edit")}</span>
        </button>
      )}
      <button
        role="menuitem"
        disabled={state.busy}
        onClick={() => {
          void state.update(collection.id, { pinned: !pinned });
          close();
        }}
      >
        {pinned ? <PinOff size={18} /> : <Pin size={18} />}
        <span>{t(pinned ? "games.collections.unpin" : "games.collections.pin")}</span>
      </button>
    </div>,
    document.body,
  );
}
