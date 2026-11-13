import { useSyncExternalStore } from "react";

let version = 0;
const listeners = new Set<() => void>();

export function notifyTrackerStatusChanged(): void {
  version += 1;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useTrackerStatusVersion(): number {
  return useSyncExternalStore(
    subscribe,
    () => version,
    () => version,
  );
}
