import { useSyncExternalStore } from "react";
import { readMusicPreference, writeMusicPreference } from "./preferences";

const PREFERENCE_KEY = "harbor.music.dock-auto-hide.v1";
// Existing users retain the visible dock until they opt in.
let autoHideEnabled = readMusicPreference(PREFERENCE_KEY) === "true";
const listeners = new Set<() => void>();

export function useMusicDockAutoHide(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => autoHideEnabled,
    () => false,
  );
}

export function setMusicDockAutoHide(enabled: boolean): void {
  if (autoHideEnabled === enabled) return;
  autoHideEnabled = enabled;
  writeMusicPreference(PREFERENCE_KEY, String(enabled));
  listeners.forEach((listener) => listener());
}

/** Time after the pointer leaves before the dock slides below the viewport. */
export const MUSIC_DOCK_AUTO_HIDE_MS = 2_000;

/** A narrow bottom-edge target remains accessible while the dock is hidden. */
export const MUSIC_DOCK_REVEAL_ZONE_PX = 28;

export function musicDockHasInteraction(
  dock: HTMLElement | null,
  pointer: { x: number; y: number } | null,
): boolean {
  if (!dock) return false;
  const focused = dock.ownerDocument.activeElement;
  // Mouse clicks leave focus behind after a panel closes. Only keyboard focus
  // should keep the dock visible once the pointer is outside its current bounds.
  if (focused && dock.contains(focused) && focused.matches(":focus-visible")) return true;
  if (!pointer) return false;
  const bounds = dock.getBoundingClientRect();
  return (
    pointer.x >= bounds.left &&
    pointer.x < bounds.right &&
    pointer.y >= bounds.top &&
    pointer.y < bounds.bottom
  );
}

export function musicDockCanAutoHide({
  enabled,
  visible,
  collapsed,
  expanded,
  queueOpen,
  sourceOpen,
  dragging,
  closing,
  error,
}: {
  enabled: boolean;
  visible: boolean;
  collapsed: boolean;
  expanded: boolean;
  queueOpen: boolean;
  sourceOpen: boolean;
  dragging: boolean;
  closing: boolean;
  error: boolean;
}): boolean {
  return (
    enabled &&
    visible &&
    !collapsed &&
    !expanded &&
    !queueOpen &&
    !sourceOpen &&
    !dragging &&
    !closing &&
    !error
  );
}
