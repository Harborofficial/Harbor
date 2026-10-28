import type { TrayDisplay } from "../lib/tray-menu-state";

export type TrayPrefs = {
  closeToTray: boolean;
  alwaysOnTop: boolean;
  pauseMinimized: boolean;
  pauseUnfocused: boolean;
};

export type TrayAction =
  | { type: "show" | "alwaysOnTop" | "pauseMinimized" | "pauseUnfocused" | "closeToTray" | "quit" }
  | { type: "theme"; value: string };

export type TrayLayout = {
  width: number;
  height: number;
  mainX: number;
  mainY: number;
  mainWidth: number;
  mainHeight: number;
  themeX: number;
  themeY: number;
  themeWidth: number;
  themeHeight: number;
  submenuSide: "left" | "right";
};

export type TraySnapshot = {
  revision: number;
  openId: number;
  open: boolean;
  closing: boolean;
  prefs: TrayPrefs;
  display: TrayDisplay | null;
  layout: TrayLayout;
};

export function newerSnapshot(current: TraySnapshot | null, incoming: TraySnapshot): TraySnapshot {
  return current && current.revision >= incoming.revision ? current : incoming;
}
