import { useSyncExternalStore } from "react";
import type { MusicTrack } from "./types";

const ENABLED_KEY = "harbor.music.video-mini.v1";

export type MusicVideoMiniState = {
  enabled: boolean;
  watchOpen: boolean;
  hidden: boolean;
  collapsed: boolean;
};

export type MusicWatchRequest = { track: MusicTrack; queue: MusicTrack[] };

const listeners = new Set<() => void>();
let pending: MusicWatchRequest | null = null;

function savedEnabled(): boolean {
  try {
    return localStorage.getItem(ENABLED_KEY) !== "0";
  } catch {
    return true;
  }
}

let state: MusicVideoMiniState = {
  enabled: savedEnabled(),
  watchOpen: false,
  hidden: false,
  collapsed: false,
};

function publish(next: Partial<MusicVideoMiniState>): void {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

export function useMusicVideoMini(): MusicVideoMiniState {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => state,
  );
}

export function setMusicVideoMiniEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(ENABLED_KEY, enabled ? "1" : "0");
  } catch {
    /* The choice still applies for this session. */
  }
  publish({ enabled });
}

/** Called by the watch page so the mini player yields while the stage is showing. */
export function setMusicWatchOpen(open: boolean): void {
  publish(open ? { watchOpen: true, hidden: false, collapsed: false } : { watchOpen: false });
}

export function collapseMusicVideoMini(): void {
  publish({ collapsed: !state.collapsed });
}

export function closeMusicVideoMini(): void {
  publish({ hidden: true });
}

/** Queued for the Music view, which may not be mounted when a mini player is clicked. */
export function requestMusicWatch(track: MusicTrack, queue: MusicTrack[]): void {
  pending = { track, queue };
  publish({ hidden: false, collapsed: false });
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("harbor:music-watch", { detail: pending }));
  }
}

export function takePendingMusicWatch(): MusicWatchRequest | null {
  const request = pending;
  pending = null;
  return request;
}
