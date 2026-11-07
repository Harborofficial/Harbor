import { Channel, invoke } from "@tauri-apps/api/core";
import { HARBOR_API_BASE } from "@/lib/config/endpoints";
import { safeFetch } from "@/lib/safe-fetch";
import type { UpdateChannel } from "./channel";
import { githubInstallerFor } from "./github-releases";
import { payloadVersionFor } from "./installer-plan";

export type HandoffProbe = {
  supported: boolean;
  managed: boolean;
  installDir: string;
  payloadVersion: number;
  platformKey: string;
};

export type HandoffPlan = {
  version: string;
  notes: string | null;
  url: string;
  signature: string;
  size: number | null;
  payloadVersion: number;
  verifiable: boolean;
  recoveryProtocol?: 1;
};

type ManifestEntry = {
  url?: string;
  signature?: string;
  size?: number;
  payloadVersion?: number;
};

type Manifest = {
  version?: string;
  notes?: string;
  installer?: Record<string, ManifestEntry>;
};

type StageEvent =
  | { kind: "started"; total: number | null }
  | { kind: "progress"; received: number; total: number | null }
  | { kind: "verifying" }
  | { kind: "ready" };

export type StageProgress = {
  received: number;
  total: number | null;
  verifying: boolean;
};

export async function probeHandoff(): Promise<HandoffProbe | null> {
  try {
    return await invoke<HandoffProbe>("handoff_probe");
  } catch {
    return null;
  }
}

export async function readHandoffPlan(init?: RequestInit): Promise<HandoffPlan | null> {
  const probe = await probeHandoff();
  if (!probe?.supported || !probe.managed) return null;
  const res = await safeFetch(`${HARBOR_API_BASE}/updates/latest.json`, {
    cache: "no-store",
    ...init,
  });
  if (!res.ok) return null;
  const manifest = (await res.json()) as Manifest;
  const entry = manifest.installer?.[probe.platformKey];
  if (!entry?.url) return null;
  const payloadVersion = Number(entry.payloadVersion ?? 0);
  const { getVersion } = await import("@tauri-apps/api/app");
  const running = await getVersion().catch(() => "");
  const [major = 0, minor = 0, patch = 0] = running
    .split(/[.\-+]/)
    .map((n) => parseInt(n, 10) || 0);
  const runningPayload = major * 1_000_000 + minor * 1_000 + patch;
  const floor = Math.max(probe.payloadVersion, runningPayload);
  if (!Number.isFinite(payloadVersion) || payloadVersion <= floor) return null;
  const signature = typeof entry.signature === "string" ? entry.signature.trim() : "";
  return {
    version: manifest.version ?? "",
    notes: manifest.notes ?? null,
    url: entry.url,
    signature,
    size: typeof entry.size === "number" && entry.size > 0 ? entry.size : null,
    payloadVersion,
    verifiable: signature.length > 0,
  };
}

export function stageHandoff(
  plan: HandoffPlan,
  onProgress: (p: StageProgress) => void,
): Promise<void> {
  const channel = new Channel<StageEvent>();
  channel.onmessage = (ev) => {
    if (ev.kind === "started") {
      onProgress({ received: 0, total: ev.total ?? plan.size, verifying: false });
    } else if (ev.kind === "progress") {
      onProgress({ received: ev.received, total: ev.total ?? plan.size, verifying: false });
    } else if (ev.kind === "verifying") {
      onProgress({ received: plan.size ?? 0, total: plan.size, verifying: true });
    }
  };
  return invoke<void>("handoff_stage", {
    url: plan.url,
    signature: plan.signature,
    version: plan.version,
    recoverable: plan.recoveryProtocol === 1,
    onEvent: channel,
  });
}

export function launchHandoff(version?: string): Promise<void> {
  return invoke<void>("handoff_launch", { version: version ?? null });
}

export type StagedProbe = { found: boolean; version: string; path: string };

export function probeStagedVersion(version: string): Promise<StagedProbe> {
  return invoke<StagedProbe>("handoff_probe_staged", { version });
}

export type ModifyProbe = {
  found: boolean;
  version: string;
  path: string;
};

export async function probeModify(): Promise<ModifyProbe | null> {
  try {
    return await invoke<ModifyProbe>("modify_probe");
  } catch {
    return null;
  }
}

/** Opens the staged copy of Harbor Setup; the app closes first with the same flush an update
 * uses, so nothing is lost while the installer works. */
export function openModify(path?: string): Promise<void> {
  return invoke<void>("modify_open", { path: path ?? null });
}

function sameVersion(a: string | null | undefined, b: string): boolean {
  return (a ?? "").trim().replace(/^v/i, "") === b.trim().replace(/^v/i, "");
}

/** The setup entry for changing features. Only the installed version is acceptable: one setup
 * per release serves both, and an unsigned entry is never offered. */
export async function readModifyPlan(
  channel: UpdateChannel = "stable",
): Promise<HandoffPlan | null> {
  const probe = await probeHandoff();
  if (!probe?.supported || !probe.managed) return null;
  const { getVersion } = await import("@tauri-apps/api/app");
  const installedVersion = await getVersion();
  let manifest: Manifest | null = null;
  try {
    const res = await safeFetch(`${HARBOR_API_BASE}/updates/latest.json`, {
      cache: "no-store",
      headers: { "x-harbor-channel": channel },
    });
    if (res.ok) manifest = (await res.json()) as Manifest;
  } catch {
    manifest = null;
  }
  if (manifest && sameVersion(manifest.version, installedVersion)) {
    const entry = manifest.installer?.[probe.platformKey];
    const signature = typeof entry?.signature === "string" ? entry.signature.trim() : "";
    const payloadVersion = Number(entry?.payloadVersion ?? 0);
    if (
      entry?.url &&
      signature &&
      Number.isFinite(payloadVersion) &&
      payloadVersion >= probe.payloadVersion
    ) {
      return {
        version: manifest.version ?? installedVersion,
        notes: manifest.notes ?? null,
        url: entry.url,
        signature,
        size: typeof entry.size === "number" && entry.size > 0 ? entry.size : null,
        payloadVersion,
        verifiable: true,
      };
    }
  }
  if (channel === "experimental") return null;
  try {
    const release = await githubInstallerFor(installedVersion, channel);
    if (!release) return null;
    const res = await safeFetch(release.signatureUrl, { cache: "no-store" });
    if (!res.ok) return null;
    const signature = (await res.text()).trim();
    const payloadVersion = payloadVersionFor(release.version);
    if (!signature || payloadVersion === null || payloadVersion < probe.payloadVersion) return null;
    return {
      version: release.version,
      notes: release.notes,
      url: release.url,
      signature,
      size: release.size,
      payloadVersion,
      verifiable: true,
    };
  } catch {
    return null;
  }
}
