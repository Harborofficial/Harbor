import { safeFetch } from "@/lib/safe-fetch";
import { normalizeReleaseTag, type GithubRelease } from "./github-release-format";
import { payloadVersionFor } from "./installer-plan";
import type { HandoffPlan, HandoffProbe } from "./handoff";
import type { NormalUpdateChannel } from "./channel";

const API = "https://api.github.com/repos/Harborofficial/Harbor/releases";
const RELEASES = "https://github.com/Harborofficial/Harbor/releases";

export function compareReleaseVersions(a: string, b: string): number {
  const left = a
    .replace(/^v/i, "")
    .split(/[.\-+]/)
    .slice(0, 3)
    .map(Number);
  const right = b
    .replace(/^v/i, "")
    .split(/[.\-+]/)
    .slice(0, 3)
    .map(Number);
  if (
    left.length !== 3 ||
    right.length !== 3 ||
    [...left, ...right].some((n) => !Number.isSafeInteger(n))
  )
    return 0;
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] - right[i];
  return 0;
}

export function selectGithubUpdate(
  releases: GithubRelease[],
  installed: string,
  preference: NormalUpdateChannel = "stable",
) {
  return (
    releases
      .flatMap((raw) => {
        if (!raw || raw.draft || typeof raw.tag_name !== "string") return [];
        const parsed = normalizeReleaseTag(raw.tag_name);
        if (!parsed || compareReleaseVersions(parsed.version, installed) <= 0) return [];
        const channel = raw.prerelease ? ("beta" as const) : parsed.channel;
        if (preference === "stable" && channel === "beta") return [];
        return [{ ...parsed, channel, raw }];
      })
      .sort((a, b) => compareReleaseVersions(b.version, a.version))[0] ?? null
  );
}

type Asset = NonNullable<GithubRelease["assets"]>[number];

function usableAssets(raw: GithubRelease): Asset[] {
  return (Array.isArray(raw.assets) ? raw.assets : []).filter(
    (asset) =>
      typeof asset.name === "string" &&
      typeof asset.browser_download_url === "string" &&
      asset.browser_download_url.startsWith(`${RELEASES}/download/`) &&
      /^harbor[-_]/i.test(asset.name) &&
      !/legacy|uninstall/i.test(asset.name),
  );
}

const BINARY = /\.(?:exe|dmg|msi|app\.tar\.gz|deb|rpm|appimage)$/i;

export function releaseIsComplete(raw: GithubRelease, probe: HandoffProbe | null): boolean {
  const assets = usableAssets(raw);
  if (!assets.some((asset) => BINARY.test(asset.name!) && !/\.sig$/i.test(asset.name!))) {
    return false;
  }
  if (!(probe?.supported && probe.managed && probe.platformKey === "windows-x86_64")) return true;
  const installer = assets.find((asset) =>
    /^harbor-shipyard-v\d+\.\d+\.\d+(?:-(?:beta|stable))?\.exe$/i.test(asset.name!),
  );
  return !!installer && assets.some((asset) => asset.name === `${installer.name}.sig`);
}

export function githubDownloadAsset(raw: GithubRelease, platformKey: string | undefined) {
  const assets = usableAssets(raw);
  if (platformKey === "windows-x86_64") {
    const shipyard = assets.find((asset) =>
      /^harbor-shipyard-v\d+\.\d+\.\d+(?:-(?:beta|stable))?\.exe$/i.test(asset.name!),
    );
    if (shipyard) return shipyard;
  }
  const architectures: Record<string, RegExp> = {
    "windows-x86_64": /(?:^|[-_])(?:x64|x86_64|amd64)(?=[-_.]|$)/i,
    "windows-aarch64": /(?:^|[-_])(?:aarch64|arm64)(?=[-_.]|$)/i,
    "windows-i686": /(?:^|[-_])(?:i686|x86)(?=[-.]|$)/i,
    "darwin-aarch64": /(?:^|[-_])(?:aarch64|arm64)(?=[-_.]|$)/i,
    "darwin-x86_64": /(?:^|[-_])(?:x64|x86_64|amd64|intel)(?=[-_.]|$)/i,
  };
  const architecture = platformKey ? architectures[platformKey] : undefined;
  if (!architecture) return null;
  const extension = platformKey!.startsWith("windows-") ? /\.exe$/i : /\.dmg$/i;
  const candidates = assets.filter((asset) => extension.test(asset.name!));
  return (
    candidates.find((asset) => architecture.test(asset.name!)) ??
    (platformKey!.startsWith("darwin-")
      ? candidates.find((asset) => /(?:^|[-_])universal(?=[-_.]|$)/i.test(asset.name!))
      : null) ??
    null
  );
}

async function fetchRelease(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    return await safeFetch(url, {
      headers: { Accept: "application/vnd.github+json" },
      cache: "no-store",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function discoverGithubUpdate(
  installed: string,
  probe: HandoffProbe | null,
  preference: NormalUpdateChannel = "stable",
) {
  const releases: GithubRelease[] = [];
  for (let page = 1; ; page++) {
    const response = await fetchRelease(`${API}?per_page=100&page=${page}`);
    if (!response.ok)
      throw new Error(`GitHub update check failed (HTTP ${response.status}). Try again later.`);
    const batch: unknown = await response.json();
    if (!Array.isArray(batch)) throw new Error("GitHub returned an invalid releases list.");
    releases.push(...batch);
    if (batch.length < 100) break;
  }
  const complete = releases.filter((raw) => releaseIsComplete(raw, probe));
  const selected = selectGithubUpdate(complete, installed, preference);
  if (!selected) return null;
  const { raw, version, channel } = selected;
  const asset = githubDownloadAsset(raw, probe?.platformKey);
  const url = asset?.browser_download_url ?? `${RELEASES}/tag/${encodeURIComponent(raw.tag_name!)}`;
  const notes = typeof raw.body === "string" ? raw.body : null;
  let handoff: HandoffPlan | null = null;
  // Shipyard is the managed Windows installer. Other assets remain manual downloads.
  if (probe?.supported && probe.managed && probe.platformKey === "windows-x86_64") {
    const assets = Array.isArray(raw.assets) ? raw.assets : [];
    const installer = asset && /^harbor-shipyard-/i.test(asset.name ?? "") ? asset : null;
    const signatureAsset =
      installer && assets.find((asset) => asset.name === `${installer.name}.sig`);
    const payloadVersion = payloadVersionFor(version);
    const trusted = (value: unknown): value is string =>
      typeof value === "string" && value.startsWith(`${RELEASES}/download/`);
    if (
      installer &&
      trusted(installer.browser_download_url) &&
      signatureAsset &&
      trusted(signatureAsset.browser_download_url) &&
      payloadVersion !== null &&
      payloadVersion > probe.payloadVersion
    ) {
      const response = await fetchRelease(signatureAsset.browser_download_url);
      if (!response.ok) throw new Error("Could not fetch the release installer signature.");
      const signature = (await response.text()).trim();
      if (!signature) throw new Error("The release installer signature is empty.");
      handoff = {
        version,
        notes,
        url: installer.browser_download_url,
        signature,
        size: installer.size ?? null,
        payloadVersion,
        verifiable: true,
      };
    }
  }
  return { version, channel, notes, url, handoff };
}
