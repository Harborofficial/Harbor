import { useEffect, useState } from "react";
import { createObjectUrlCache } from "./object-url-cache";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { suwayomiAuthFor } from "@/lib/manga/sources/suwayomi/auth-registry";
import { useSettings } from "@/lib/settings";
import { idbCacheGet, idbCacheDelete, idbCacheKeys } from "@/lib/idb-cache";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

type HarborFetchResponse = {
  status: number;
  ok: boolean;
  body: string;
  contentType?: string | null;
  headers?: Record<string, string>;
};

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64.trim());
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Remote plain-HTTP images are blocked by the WebView as mixed content: the app
// page is a secure context, so http://localhost is exempt but http://<remote>
// is refused (https is fine). Route those through the Rust side and hand back a
// same-origin blob URL. Covers e.g. a Suwayomi server hosted on a VPS over HTTP.
export function needsImageProxy(url: string): boolean {
  if (!isTauri) return false;
  // An <img> tag cannot send an Authorization header, so any server behind
  // basic auth must be fetched through Rust regardless of scheme.
  if (suwayomiAuthFor(url)) return true;
  if (!url.startsWith("http://")) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return !(
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "::1" ||
      host.endsWith(".localhost")
    );
  } catch {
    return false;
  }
}

const blobCache = createObjectUrlCache();
type BlobEntry = NonNullable<ReturnType<typeof blobCache.get>>;
type ProxyImageResult = BlobEntry | string;
// Module scoped, like the blob cache beside it. A failure used to live in
// component state, so every remount re-invoked harbor_fetch for a url already
// known to be dead, and each of those is a bridge crossing carrying a base64
// image body. The in-flight map is for the row where twenty cells share a logo.
const deadUrls = new Map<string, number>();
function isDead(url: string): boolean {
  if ((deadUrls.get(url) ?? 0) > Date.now()) return true;
  deadUrls.delete(url);
  return false;
}
const inflight = new Map<string, Promise<ProxyImageResult | null>>();
// Legacy poster blobs share a database with pinned music; only this prefix is disposable.
const POSTER_PREFIX = "season-poster:v1:";
const POSTER_TTL = 7 * 24 * 60 * 60_000;
let legacyPruned = false;
let pruning: Promise<void> | undefined;
let cacheGeneration = 0;

function prunePosters(): void {
  if (pruning) return;
  pruning = (async () => {
    const keys = (await idbCacheKeys()).filter((key) => key.startsWith(POSTER_PREFIX));
    const entries = await Promise.all(
      keys.map(async (key) => ({ key, entry: await idbCacheGet(key) })),
    );
    entries.sort((a, b) => (b.entry?.at ?? 0) - (a.entry?.at ?? 0));
    await Promise.all(
      entries
        .filter(({ entry }, i) => i >= 120 || !entry || Date.now() - entry.at >= POSTER_TTL)
        .map(({ key }) => idbCacheDelete(key)),
    );
  })()
    .catch(() => {})
    .finally(() => {
      pruning = undefined;
    });
}

export async function clearThumbCache(): Promise<void> {
  cacheGeneration++;
  blobCache.clear();
  inflight.clear();
  deadUrls.clear();
  const keys = (await idbCacheKeys()).filter((key) => key.startsWith(POSTER_PREFIX));
  await Promise.all(keys.map(idbCacheDelete));
  await invoke("clear_thumb_cache");
}

export type ThumbCacheSize = { bytes: number; files: number };

export async function getThumbCacheSize(): Promise<ThumbCacheSize | null> {
  try {
    const size = await invoke<ThumbCacheSize>("thumb_cache_size");
    if (!size || typeof size.bytes !== "number" || typeof size.files !== "number") return null;
    return size;
  } catch {
    return null;
  }
}

function proxyImage(
  url: string,
  thumbWidthPx?: number,
  persistent = false,
  migrateLegacy = true,
): Promise<ProxyImageResult | null> {
  const generation = cacheGeneration;
  const key = cacheKeyFor(url, thumbWidthPx);
  const cached = blobCache.get(key);
  if (cached) return Promise.resolve(cached);
  if (isDead(key)) return Promise.resolve(null);
  const existing = inflight.get(key);
  if (existing) return existing;
  const p = (async () => {
    try {
      const auth = suwayomiAuthFor(url);
      const diskKey = `${POSTER_PREFIX}${thumbWidthPx ?? 0}\n${url}`;
      const persist = persistent && !auth;
      if (persist && !legacyPruned) {
        legacyPruned = true;
        prunePosters();
      }
      if (persist) {
        // A fresh native entry can be served straight through the asset
        // protocol; this avoids the base64 IPC + Blob path on warm posters.
        const path = await invoke<string | null>("cached_thumb_path", {
          url,
          width: thumbWidthPx ?? 0,
        }).catch(() => null);
        if (generation !== cacheGeneration) return null;
        if (typeof path === "string" && path) return convertFileSrc(path);
      }
      if (persist && migrateLegacy) {
        const entry = await Promise.resolve()
          .then(() => idbCacheGet(diskKey))
          .catch(() => null);
        if (generation !== cacheGeneration) return null;
        if (entry && Date.now() - entry.at < POSTER_TTL && entry.data instanceof Blob) {
          const created = blobCache.set(key, entry.data);
          return created;
        }
      }
      const resp = await invoke<HarborFetchResponse>("harbor_fetch", {
        args: {
          url,
          method: "GET",
          responseType: "base64",
          timeoutMs: 30000,
          headers: auth ? { authorization: auth } : undefined,
          allowLocalNetwork: Boolean(auth),
          thumbWidthPx,
          cacheImage: persist,
          maxResponseBytes: 32 * 1024 * 1024,
        },
      });
      if (!resp.ok) throw new Error(`status ${resp.status}`);
      if (generation !== cacheGeneration) return null;
      if (persistent && typeof window !== "undefined")
        window.__harborProfiler?.mark("image-cache", {
          result: resp.headers?.["x-harbor-image-cache"] ?? "bypass",
        });
      const type = resp.headers?.["content-type"] || resp.contentType || "image/jpeg";
      if (type && !type.startsWith("image/")) throw new Error(`type ${type}`);
      const blob = new Blob([base64ToBytes(resp.body)], { type });
      const control = resp.headers?.["cache-control"] ?? "";
      const age =
        resp.headers?.["x-harbor-image-max-age"] ?? /(?:^|,)\s*max-age="?(\d+)/i.exec(control)?.[1];
      const ttl = /(?:^|,)\s*(?:no-store|no-cache|private)(?:,|$)/i.test(control)
        ? 0
        : age !== undefined
          ? Number(age) * 1000
          : undefined;
      const created = blobCache.set(key, blob, Number.isFinite(ttl) ? ttl : undefined);
      return created;
    } catch {
      if (generation !== cacheGeneration) return null;
      deadUrls.set(key, Date.now() + 60_000);
      while (deadUrls.size > 300) deadUrls.delete(deadUrls.keys().next().value!);
      return null;
    }
  })().finally(() => {
    if (inflight.get(key) === p) inflight.delete(key);
  });
  inflight.set(key, p);
  return p;
}

const cacheKeyFor = (url: string, thumbWidthPx?: number): string =>
  `${thumbWidthPx ?? 0}\n${suwayomiAuthFor(url) ?? ""}\n${url}`;

export function useProxiedImageSrc(
  url: string | undefined,
  opts?: { forceProxy?: boolean; persistent?: boolean; enabled?: boolean; originalSize?: boolean },
): string | undefined {
  const need =
    isTauri &&
    !!url &&
    (opts?.forceProxy
      ? url.startsWith("http://") || url.startsWith("https://")
      : needsImageProxy(url));
  const { settings } = useSettings();
  const persistent = opts?.persistent === true;
  const thumbWidthPx =
    opts?.originalSize || settings.posterQuality === "max"
      ? undefined
      : settings.posterQuality === "high"
        ? 600
        : 400;
  const imageKey = cacheKeyFor(url ?? "", thumbWidthPx);
  const [blob, setBlob] = useState<{ key: string; src: string } | undefined>(() => {
    const cached = url && need ? blobCache.get(imageKey) : undefined;
    return cached ? { key: imageKey, src: cached.src } : undefined;
  });
  const [failed, setFailed] = useState(() =>
    url && need && isDead(imageKey) ? imageKey : undefined,
  );
  useEffect(() => {
    if (!url || !need || opts?.enabled === false) {
      setFailed(undefined);
      setBlob(undefined);
      return;
    }
    const cached = blobCache.get(cacheKeyFor(url, thumbWidthPx));
    if (cached) {
      setFailed(undefined);
      setBlob((previous) =>
        previous?.key === imageKey && previous.src === cached.src
          ? previous
          : { key: imageKey, src: cached.src },
      );
      return blobCache.retain(cached);
    }
    if (isDead(imageKey)) {
      setBlob(undefined);
      setFailed(imageKey);
      return;
    }
    setFailed(undefined);
    setBlob(undefined);
    let alive = true;
    const generation = cacheGeneration;
    let release: (() => void) | undefined;
    void proxyImage(url, thumbWidthPx, persistent, !opts?.originalSize).then((created) => {
      if (!alive || generation !== cacheGeneration) return;
      if (typeof created === "string") {
        setBlob({ key: imageKey, src: created });
        return;
      }
      if (created && !created.retired) {
        release = blobCache.retain(created);
        setBlob({ key: imageKey, src: created.src });
      } else setFailed(imageKey);
    });
    return () => {
      alive = false;
      release?.();
    };
  }, [url, imageKey, need, thumbWidthPx, persistent, opts?.enabled, opts?.originalSize]);
  if (opts?.enabled === false) return undefined;
  if (!need) return url;
  // Loading -> undefined (caller shows its placeholder/shimmer). Failed -> the
  // original url so the <img> errors and the caller's fallback/plate logic runs.
  return blob?.key === imageKey ? blob.src : failed === imageKey ? url : undefined;
}
