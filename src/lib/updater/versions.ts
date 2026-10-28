import { isMacDesktop, isWindowsDesktop } from "@/lib/platform";
import { githubVersionHistory } from "./github-releases";

export type VersionEntry = {
  version: string;
  date?: string;
  notes?: string;
  win?: string;
  winSig?: string;
  mac?: string;
  channel?: "beta" | "stable";
};

export const currentVersion = __APP_VERSION__;

export async function fetchVersionHistory(): Promise<VersionEntry[]> {
  return githubVersionHistory();
}

export function installerUrl(entry: VersionEntry): string | null {
  if (isWindowsDesktop()) return entry.win ?? null;
  if (isMacDesktop()) return entry.mac ?? null;
  return null;
}
