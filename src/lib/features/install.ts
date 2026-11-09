import { invoke } from "@tauri-apps/api/core";
import { useSyncExternalStore } from "react";

export type InstallFeatureKey = "plugins" | "games" | "music" | "ebook" | "manga";
export type InstallFeatures = Record<InstallFeatureKey, boolean>;

const ALL_ON: InstallFeatures = {
  plugins: true,
  games: true,
  music: true,
  ebook: true,
  manga: true,
};

let snapshot: InstallFeatures = ALL_ON;
let loading: Promise<void> | null = null;
let ready = false;
const listeners = new Set<() => void>();

export async function readInstallFeatures(): Promise<InstallFeatures> {
  const value = await invoke<Partial<InstallFeatures>>("install_features");
  return { ...ALL_ON, ...value };
}

export function getInstallFeatures(): InstallFeatures {
  loadInstallFeatures();
  return snapshot;
}

function publish(next: InstallFeatures) {
  snapshot = next;
  ready = true;
  listeners.forEach((listener) => listener());
}

/** One read per session. Native availability combines compiled components and the install
 * marker; older builds and web previews retain their existing all-enabled fallback. */
export function loadInstallFeatures(): Promise<void> {
  if (loading) return loading;
  loading = readInstallFeatures()
    .then(publish)
    .catch(() => {
      loading = null; // web preview or an older build: let the next mount try again
      if (!ready) publish(ALL_ON);
    });
  return loading;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  loadInstallFeatures();
  return () => {
    listeners.delete(listener);
  };
}

export function useInstallFeatures(): InstallFeatures {
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => ALL_ON,
  );
}

/** Prevent Music startup work until native component availability is known. */
export function useInstallFeaturesReady(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => ready,
    () => false,
  );
}
