import { safeFetch } from "@/lib/safe-fetch";
import type { ReleaseNote } from "./release-notes";
import type { VersionEntry } from "./versions";
import {
  installerForVersion,
  newestReleases,
  parseGithubRelease,
  type GithubRelease,
  type ParsedRelease,
} from "./github-release-format";

const API_URL = "https://api.github.com/repos/Harborofficial/Harbor/releases?per_page=30";
const CACHE_KEY = "harbor.github.releases.v1";
const FRESH_MS = 30 * 60 * 1000;

type Cache = { etag: string | null; fetchedAt: number; releases: GithubRelease[] };

let memory: Cache | null = null;
let loading: Promise<ParsedRelease[]> | null = null;

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function readCache(): Cache | null {
  if (memory) return memory;
  try {
    const raw = storage()?.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Cache;
    if (!Array.isArray(parsed.releases)) return null;
    memory = parsed;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(cache: Cache): GithubRelease[] {
  memory = cache;
  try {
    storage()?.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    /* private mode: the in-memory copy still serves this session */
  }
  return cache.releases;
}

function parseAll(releases: GithubRelease[]): ParsedRelease[] {
  const parsed = releases
    .map((release) => parseGithubRelease(release))
    .filter((release): release is ParsedRelease => release !== null);
  return newestReleases(parsed);
}

async function loadReleases(): Promise<ParsedRelease[]> {
  const cached = readCache();
  if (cached && Date.now() - cached.fetchedAt < FRESH_MS) {
    const parsed = parseAll(cached.releases);
    if (parsed.length) return parsed;
  }
  if (loading) return loading;
  loading = (async () => {
    try {
      const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
      if (cached?.etag) headers["If-None-Match"] = cached.etag;
      const res = await safeFetch(API_URL, { headers, cache: "no-store" });
      if (res.status === 304 && cached) {
        const releases = writeCache({ ...cached, fetchedAt: Date.now() });
        return parseAll(releases);
      }
      if (!res.ok) throw new Error(`github releases ${res.status}`);
      const json = (await res.json()) as unknown;
      if (!Array.isArray(json)) throw new Error("github releases: unexpected response");
      const releases = writeCache({
        etag: res.headers.get("etag"),
        fetchedAt: Date.now(),
        releases: json as GithubRelease[],
      });
      const parsed = parseAll(releases);
      if (!parsed.length) throw new Error("github releases: no app releases");
      return parsed;
    } catch (error) {
      if (cached) {
        const parsed = parseAll(cached.releases);
        if (parsed.length) return parsed;
      }
      throw error;
    } finally {
      loading = null;
    }
  })();
  return loading;
}

export async function githubReleaseNote(
  version: string,
  channel?: "beta" | "stable",
): Promise<ReleaseNote | null> {
  try {
    const matches = (await loadReleases()).filter((release) => release.version === version);
    if (!matches.length) return null;
    const match =
      matches.find((release) => release.channel === channel) ??
      matches.find((release) => release.channel === "stable") ??
      matches[0];
    return match.note;
  } catch {
    return null;
  }
}

export type GithubInstaller = {
  version: string;
  url: string;
  signatureUrl: string;
  size: number | null;
  notes: string | null;
};

export async function githubInstallerFor(
  version: string,
  channel?: "beta" | "stable",
): Promise<GithubInstaller | null> {
  const release = installerForVersion(await loadReleases(), version, channel);
  if (!release?.win || !release.winSig) return null;
  return {
    version: release.version,
    url: release.win,
    signatureUrl: release.winSig,
    size: release.winSize,
    notes: release.summary,
  };
}

export async function githubVersionHistory(): Promise<VersionEntry[]> {
  return (await loadReleases()).map((release) => ({
    version: release.version,
    date: release.date ?? undefined,
    notes: release.summary ?? undefined,
    win: release.win ?? undefined,
    winSig: release.winSig ?? undefined,
    mac: release.mac ?? undefined,
    channel: release.channel,
  }));
}
