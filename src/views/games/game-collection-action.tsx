import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { FolderPlus, Heart, Info } from "lucide-react";
import { useT } from "@/lib/i18n";
import { menuPosition } from "@/lib/games/library-management";
import { gameIdentities } from "@/lib/games/recommendations";
import type { PersonalCollectionGame } from "@/lib/games/personal-collections";
import { useOptionalGameAccess } from "./game-access";
import "./game-library-context-menu.css";

type Collect = (game: PersonalCollectionGame | PersonalCollectionGame[]) => void;
type MenuTarget = { game: PersonalCollectionGame; x: number; y: number };
type OpenMenu = (game: PersonalCollectionGame, x: number, y: number) => void;

const gameRegistry = new Map<string, { game: PersonalCollectionGame; count: number }>();
const MenuContext = createContext<OpenMenu | null>(null);

export function useRegisterGameForCollectionMenu(game?: PersonalCollectionGame | null): void {
  useEffect(() => {
    if (!game) return;
    gameRegistry.set(game.id, { game, count: (gameRegistry.get(game.id)?.count ?? 0) + 1 });
    return () => {
      const entry = gameRegistry.get(game.id);
      if (!entry) return;
      if (entry.count <= 1) gameRegistry.delete(game.id);
      else gameRegistry.set(game.id, { ...entry, count: entry.count - 1 });
    };
  }, [game]);
}

export function useGameCollectionMenu(): OpenMenu | null {
  return useContext(MenuContext);
}

export function GameCollectionActionProvider({
  collect,
  open: openGame,
  children,
}: {
  collect: Collect;
  open: (game: PersonalCollectionGame) => void;
  children: ReactNode;
}) {
  const [target, setTarget] = useState<MenuTarget | null>(null);
  const open = useCallback<OpenMenu>((game, x, y) => setTarget({ game, x, y }), []);
  const close = useCallback(() => setTarget(null), []);
  useEffect(() => {
    const onContextMenu = (event: MouseEvent) => {
      if (event.defaultPrevented || !(event.target instanceof Element)) return;
      const id = event.target.closest<HTMLElement>("[data-game]")?.dataset.game;
      const game = id ? gameRegistry.get(id)?.game : undefined;
      if (!game) return;
      event.preventDefault();
      open(game, event.clientX, event.clientY);
    };
    document.addEventListener("contextmenu", onContextMenu);
    return () => document.removeEventListener("contextmenu", onContextMenu);
  }, [open]);
  return (
    <MenuContext.Provider value={open}>
      {children}
      {target && (
        <GameCollectionMenu target={target} collect={collect} open={openGame} close={close} />
      )}
    </MenuContext.Provider>
  );
}

function GameCollectionMenu({
  target,
  collect,
  open,
  close,
}: {
  target: MenuTarget;
  collect: Collect;
  open: (game: PersonalCollectionGame) => void;
  close: () => void;
}) {
  const t = useT(),
    access = useOptionalGameAccess(),
    aliases = new Set(gameIdentities(target.game)),
    savedGame = access?.saved.find((game) => gameIdentities(game).some((id) => aliases.has(id)));
  const root = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: target.x, top: target.y });
  useLayoutEffect(() => {
    const box = root.current?.getBoundingClientRect();
    if (box)
      setPosition(menuPosition(target.x, target.y, box.width, box.height, innerWidth, innerHeight));
  }, [target]);
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
  return createPortal(
    <div
      ref={root}
      className="g-library-context g-game-collection-context"
      style={position}
      role="menu"
      aria-label={t("games.collections.addTo")}
      data-dropdown-menu
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        close();
      }}
    >
      <button
        role="menuitem"
        onClick={() => {
          open(target.game);
          close();
        }}
      >
        <Info size={18} />
        <span>{t("games.manage.details")}</span>
      </button>
      {access && (
        <button
          role="menuitem"
          onClick={() => {
            void access.save(savedGame ?? target.game);
            close();
          }}
        >
          <Heart size={18} fill={savedGame ? "currentColor" : "none"} />
          <span>
            {t(savedGame ? "games.recommend.removeSaved" : "games.recommend.save", {
              name: target.game.name,
            })}
          </span>
        </button>
      )}
      <hr />
      <button
        role="menuitem"
        onClick={() => {
          collect(target.game);
          close();
        }}
      >
        <FolderPlus size={18} />
        <span>{t("games.collections.addTo")}</span>
      </button>
    </div>,
    document.body,
  );
}
