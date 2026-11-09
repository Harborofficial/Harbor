import { invoke } from "@tauri-apps/api/core";
import { isLinuxDesktop, isMacDesktop, isWindowsDesktop } from "@/lib/platform";
import type { ProfileAudio } from "./profile-audio";

export type ResolvedProfileAudio = {
  url: string;
  mimeType: string;
  headers: Record<string, string>;
  expiresAt: number | null;
};

const CACHE_MAX = 8;
const YOUTUBE_TTL = 25 * 60_000;
const SOUNDCLOUD_TTL = 2 * 60_000;
const EXPIRY_MARGIN = 30_000;

type CacheEntry = { stream: ResolvedProfileAudio; expires: number };

const cache = new Map<string, CacheEntry>();
const pending = new Map<string, Promise<ResolvedProfileAudio>>();

/** The yt-dlp sidecar is a desktop asset; Android, iOS and the web keep the iframe path. */
export function canResolveProfileAudio(): boolean {
  return (
    typeof window !== "undefined" &&
    "__TAURI_INTERNALS__" in window &&
    (isWindowsDesktop() || isMacDesktop() || isLinuxDesktop())
  );
}

function cacheKey(audio: ProfileAudio): string {
  return `${audio.provider}:${audio.url}`;
}

function ttlFor(audio: ProfileAudio, stream: ResolvedProfileAudio): number {
  const base = audio.provider === "soundcloud" ? SOUNDCLOUD_TTL : YOUTUBE_TTL;
  const signed = stream.expiresAt ? stream.expiresAt * 1000 - EXPIRY_MARGIN : Infinity;
  return Math.max(0, Math.min(Date.now() + base, signed) - Date.now());
}

function remember(key: string, audio: ProfileAudio, stream: ResolvedProfileAudio): void {
  const ttl = ttlFor(audio, stream);
  if (ttl <= 0) return;
  cache.delete(key);
  cache.set(key, { stream, expires: Date.now() + ttl });
  while (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

function cached(key: string): ResolvedProfileAudio | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (hit.expires <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return hit.stream;
}

export function clearProfileAudioCache(audio?: ProfileAudio): void {
  if (!audio) {
    cache.clear();
    return;
  }
  cache.delete(cacheKey(audio));
}

export async function resolveProfileAudio(
  audio: ProfileAudio,
  opts?: { force?: boolean },
): Promise<ResolvedProfileAudio> {
  if (!canResolveProfileAudio()) {
    throw new Error("Profile song playback is unavailable on this platform.");
  }
  const key = cacheKey(audio);
  if (opts?.force) {
    cache.delete(key);
  } else {
    const hit = cached(key);
    if (hit) return hit;
    const request = pending.get(key);
    if (request) return request;
  }
  let request: Promise<ResolvedProfileAudio>;
  request = invoke<ResolvedProfileAudio>("resolve_profile_audio", {
    provider: audio.provider,
    url: audio.url,
  })
    .then((stream) => {
      if (!stream || typeof stream.url !== "string" || !stream.url.startsWith("https://")) {
        throw new Error("Profile song resolved without a stream.");
      }
      const normalized: ResolvedProfileAudio = {
        url: stream.url,
        mimeType: typeof stream.mimeType === "string" ? stream.mimeType : "audio/mp4",
        headers:
          stream.headers && typeof stream.headers === "object"
            ? (stream.headers as Record<string, string>)
            : {},
        expiresAt: typeof stream.expiresAt === "number" ? stream.expiresAt : null,
      };
      remember(key, audio, normalized);
      return normalized;
    })
    .finally(() => {
      if (pending.get(key) === request) pending.delete(key);
    });
  pending.set(key, request);
  return request;
}
