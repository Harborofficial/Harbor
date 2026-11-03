import { useEffect } from "react";
import { isNuvioProviderActive } from "@/lib/active-profile-id";
import { refreshExternalCw } from "@/lib/feed/external-cw";
import { isNuvioSignedIn } from "./nuvio-client";
import { reconcileNuvioWatched } from "./nuvio-sync";
import { createNuvioSyncCoordinator } from "./nuvio-sync-coordinator";

const coordinator = createNuvioSyncCoordinator({
  isActive: () => isNuvioSignedIn() && isNuvioProviderActive(),
  reconcile: (force) => reconcileNuvioWatched(undefined, { force }),
  refresh: (force) => refreshExternalCw(force),
});

export function requestNuvioSync(force = false): Promise<void> {
  return coordinator.request(force);
}

/**
 * App-level owner of the Nuvio 30s sync cadence. It replaces the separate Home
 * interval and the external-CW Nuvio poll/focus listeners.
 */
export function useNuvioSyncLoop(enabled = true): void {
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    void requestNuvioSync(true);

    const onFocus = () => {
      if (document.visibilityState === "visible") void requestNuvioSync(true);
    };
    const onNuvioEvent = () => void requestNuvioSync(true);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void requestNuvioSync(false);
    }, 30_000);

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("harbor:nuvio-profile-changed", onNuvioEvent);
    window.addEventListener("harbor:nuvio-state-changed", onNuvioEvent);
    window.addEventListener("harbor:account-provider-changed", onNuvioEvent);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("harbor:nuvio-profile-changed", onNuvioEvent);
      window.removeEventListener("harbor:nuvio-state-changed", onNuvioEvent);
      window.removeEventListener("harbor:account-provider-changed", onNuvioEvent);
    };
  }, [enabled]);
}
