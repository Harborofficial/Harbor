import type { VersionEntry } from "./versions";

export type InstallerMode = "verified" | "download" | "browser";

export type InstallerPlatform = { tauri: boolean; windows: boolean; mac: boolean };

export function payloadVersionFor(version: string): number | null {
  const parts = version.split(".");
  if (parts.length !== 3 || parts.some((part) => !/^\d+$/.test(part))) return null;
  const [major, minor, patch] = parts.map(Number);
  if (minor >= 1_000 || patch >= 1_000) return null;
  return major * 1_000_000 + minor * 1_000 + patch;
}

export function installerMode(entry: VersionEntry, platform: InstallerPlatform): InstallerMode {
  if (!platform.tauri) return "browser";
  if (platform.windows && entry.win) {
    const verifiable = !!entry.winSig && payloadVersionFor(entry.version) !== null;
    return verifiable ? "verified" : "download";
  }
  if (platform.mac && entry.mac) return "download";
  return "browser";
}

export function resumedInstallerPhase(
  mode: InstallerMode,
  staged: boolean,
  saved: boolean,
): "staged" | "saved" | "idle" {
  if (mode === "verified" && staged) return "staged";
  if (mode !== "browser" && saved) return "saved";
  return "idle";
}

export function installerFileName(url: string): string {
  try {
    const name = decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "");
    const safe = name.replace(/[^\w.\-() ]+/g, "_").replace(/^\.+/, "");
    return safe || "harbor-installer";
  } catch {
    return "harbor-installer";
  }
}
