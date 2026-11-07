import { Channel, invoke } from "@tauri-apps/api/core";
import { downloadDir, join, tempDir } from "@tauri-apps/api/path";
import { exists } from "@tauri-apps/plugin-fs";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { safeFetch } from "@/lib/safe-fetch";
import { installerFileName, payloadVersionFor } from "./installer-plan";
import { launchHandoff, probeStagedVersion, stageHandoff, type HandoffPlan } from "./handoff";
import type { VersionEntry } from "./versions";

export type InstallerProgress = { received: number; total: number | null; verifying: boolean };

const SAVED_KEY = "harbor.version-download.v1.";
const TEMP_FOLDER = "harbor-installers";

function temporaryDirectory(): Promise<string> {
  return tempDir().then((directory) => join(directory, TEMP_FOLDER));
}

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function savedInstallerPath(version: string): string | null {
  try {
    return storage()?.getItem(`${SAVED_KEY}${version}`) ?? null;
  } catch {
    return null;
  }
}

function rememberSavedInstaller(version: string, path: string): void {
  try {
    storage()?.setItem(`${SAVED_KEY}${version}`, path);
  } catch {
    /* private mode: the file still exists without the shortcut */
  }
}

export function forgetSavedInstaller(version: string): void {
  try {
    storage()?.removeItem(`${SAVED_KEY}${version}`);
  } catch {
    /* private mode */
  }
}

export async function savedInstallerExists(path: string): Promise<boolean> {
  try {
    const info = await invoke<{ exists: boolean; isFile: boolean }>("download_file_info", { path });
    return info.exists && info.isFile;
  } catch {
    return false;
  }
}

export async function probeStagedInstaller(version: string): Promise<boolean> {
  try {
    return (await probeStagedVersion(version)).found;
  } catch {
    return false;
  }
}

export async function resolveSavedInstaller(version: string, url: string): Promise<string | null> {
  const remembered = savedInstallerPath(version);
  if (remembered && (await savedInstallerExists(remembered))) return remembered;
  if (remembered) forgetSavedInstaller(version);
  for (const fallback of [
    await join(await temporaryDirectory(), installerFileName(url)),
    await join(await downloadDir(), installerFileName(url)),
  ]) {
    if (!(await savedInstallerExists(fallback))) continue;
    rememberSavedInstaller(version, fallback);
    return fallback;
  }
  return null;
}

type NativeDownloadEvent =
  | { kind: "started"; total?: number; resumed?: number }
  | { kind: "progress"; received: number; total?: number }
  | { kind: "done"; received: number }
  | { kind: "error"; message: string }
  | { kind: "canceled"; received: number };

export async function stageVersionInstaller(
  entry: VersionEntry,
  onProgress: (progress: InstallerProgress) => void,
): Promise<void> {
  const payloadVersion = payloadVersionFor(entry.version);
  if (!entry.win || !entry.winSig || payloadVersion === null) {
    throw new Error("This build has no verifiable installer.");
  }
  const res = await safeFetch(entry.winSig, { cache: "no-store" });
  if (!res.ok) throw new Error(`installer signature ${res.status}`);
  const signature = (await res.text()).trim();
  if (!signature) throw new Error("The installer signature is empty.");
  const plan: HandoffPlan = {
    version: entry.version,
    notes: entry.notes ?? null,
    url: entry.win,
    signature,
    size: null,
    payloadVersion,
    verifiable: true,
  };
  await stageHandoff(plan, (progress) =>
    onProgress({
      received: progress.received,
      total: progress.total,
      verifying: progress.verifying,
    }),
  );
}

async function uniqueDestination(name: string): Promise<string> {
  const directory = await temporaryDirectory();
  let candidate = await join(directory, name);
  if (!(await exists(candidate).catch(() => false))) return candidate;
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : "";
  for (let i = 2; i < 1000; i += 1) {
    candidate = await join(directory, `${stem} (${i})${extension}`);
    if (!(await exists(candidate).catch(() => false))) return candidate;
  }
  return join(directory, name);
}

export async function downloadVersionInstaller(
  entry: VersionEntry,
  url: string,
  onProgress: (progress: InstallerProgress) => void,
): Promise<string> {
  const dest = await uniqueDestination(installerFileName(url));
  const channel = new Channel<NativeDownloadEvent>();
  channel.onmessage = (event) => {
    if (event.kind === "started") {
      onProgress({ received: event.resumed ?? 0, total: event.total ?? null, verifying: false });
    } else if (event.kind === "progress") {
      onProgress({ received: event.received, total: event.total ?? null, verifying: false });
    }
  };
  await invoke("download_start", {
    id: `version-${entry.version}-${Date.now()}`,
    url,
    dest,
    onEvent: channel,
  });
  rememberSavedInstaller(entry.version, dest);
  return dest;
}

export function installStagedVersion(version: string): Promise<void> {
  return launchHandoff(version);
}

export function revealInstaller(path: string): Promise<void> {
  return revealItemInDir(path);
}
