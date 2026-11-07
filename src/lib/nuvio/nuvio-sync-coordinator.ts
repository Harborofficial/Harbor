export type NuvioSyncCoordinatorDeps = {
  isActive: () => boolean;
  reconcile: (force: boolean) => Promise<void>;
  refresh: (force: boolean) => Promise<void>;
};

export type NuvioSyncCoordinator = {
  request: (force?: boolean) => Promise<void>;
  isRunning: () => boolean;
};

/**
 * Coalesces Nuvio sync triggers into one in-flight cycle. Reconcile and refresh
 * run concurrently so their watched/progress pulls share the singleflight maps.
 */
export function createNuvioSyncCoordinator(deps: NuvioSyncCoordinatorDeps): NuvioSyncCoordinator {
  let inFlight: Promise<void> | null = null;
  let queuedForce = false;

  const runCycle = async (force: boolean) => {
    if (!deps.isActive()) return;
    await Promise.allSettled([deps.reconcile(force), deps.refresh(force)]);
  };

  const request = (force = false): Promise<void> => {
    if (!deps.isActive()) return Promise.resolve();
    if (inFlight) {
      if (force) queuedForce = true;
      return inFlight;
    }
    inFlight = runCycle(force)
      .catch((err) => console.warn("[nuvio] sync cycle failed", err))
      .finally(() => {
        inFlight = null;
        if (queuedForce) {
          queuedForce = false;
          void request(true);
        }
      });
    return inFlight;
  };

  return { request, isRunning: () => inFlight !== null };
}
