import type { InstallerProgress } from "./version-download";

export type InstallerPhase = "checking" | "idle" | "downloading" | "verifying" | "staged" | "saved";

type InstallerState = {
  phase: InstallerPhase;
  progress: InstallerProgress;
  savedPath: string | null;
};

function createSession() {
  let state: InstallerState = {
    phase: "checking",
    progress: { received: 0, total: null, verifying: false },
    savedPath: null,
  };
  const listeners = new Set<() => void>();
  return {
    snapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set(patch: Partial<InstallerState>) {
      state = { ...state, ...patch };
      for (const listener of listeners) listener();
    },
  };
}

// Downloads outlive the settings page and can appear in multiple version lists.
const sessions = new Map<string, ReturnType<typeof createSession>>();

export function versionDownloadSession(version: string, url: string | null, mode: string) {
  const key = JSON.stringify([version, url, mode]);
  let session = sessions.get(key);
  if (!session) {
    session = createSession();
    sessions.set(key, session);
  }
  return session;
}
