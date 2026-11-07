import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useT } from "@/lib/i18n";
import { useContextTarget } from "@/lib/context-menu";
import { useSettings } from "@/lib/settings";
import { MAX_GPU_PAGE_PIXELS, shouldUpscale } from "@/lib/manga/upscale/eligibility";
import {
  cachedMangaPage,
  mangaUpscaleProvider,
  upscaleMangaPage,
  warmMangaUpscaler,
} from "@/lib/manga/upscale";
import {
  bestModelInstalled,
  cachedBestPage,
  chapterBestHeight,
  downloadBestModel,
  noteMangaPageHeight,
  upscaleBestPage,
} from "@/lib/manga/upscale/best";
import { MANGA_PAGE_CACHED_EVENT } from "@/lib/manga/upscale/events";
import { fetchImageObjectUrl, IMAGE_FALLBACK_HEADERS } from "./reader-utils";
import { isColorPage, noteRenderedPageWidth, readableBlob } from "./manga-upscale";

type Status = "loading" | "loaded" | "error";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export function PageImage({
  url,
  headers,
  cacheKey,
  className,
  style,
  inline,
  fillHeight,
}: {
  url: string;
  headers?: Record<string, string>;
  /** Stable page identity; sources can hand out fresh URLs for the same page. */
  cacheKey?: string;
  className?: string;
  style?: React.CSSProperties;
  inline?: boolean;
  fillHeight?: boolean;
}) {
  const t = useT();
  const { settings } = useSettings();
  const cacheId = cacheKey ?? url;
  const [status, setStatus] = useState<Status>("loading");
  const [bust, setBust] = useState(0);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [headerFailed, setHeaderFailed] = useState(false);
  const [nativeFallback, setNativeFallback] = useState(false);
  const [enhanced, setEnhanced] = useState<ImageBitmap | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const enhancedRef = useRef<ImageBitmap | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [loadedTick, setLoadedTick] = useState(0);
  const enhanceToken = useRef(0);
  const autoRetried = useRef(false);
  const prevUrl = useRef(url);
  const headersRef = useRef(headers);
  headersRef.current = headers;

  const wantHeaderFetch = isTauri && !!headers && Object.keys(headers).length > 0 && !headerFailed;
  const wantUpscaleBytes = isTauri && settings.mangaUpscaleEnabled;
  const nativeFetch = wantHeaderFetch || (isTauri && nativeFallback);

  const failHeaders = () => {
    setBlobUrl(null);
    setHeaderFailed(true);
  };

  if (prevUrl.current !== url) {
    prevUrl.current = url;
    setStatus("loading");
    setBust(0);
    setBlobUrl(null);
    setHeaderFailed(false);
    setNativeFallback(false);
    enhancedRef.current?.close();
    enhancedRef.current = null;
    setEnhanced(null);
    enhanceToken.current += 1;
    autoRetried.current = false;
  }

  useEffect(() => {
    return () => {
      enhanceToken.current += 1;
      enhancedRef.current?.close();
      enhancedRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (wantUpscaleBytes) warmMangaUpscaler();
  }, [wantUpscaleBytes]);

  useEffect(() => {
    enhanceToken.current += 1;
    enhancedRef.current?.close();
    enhancedRef.current = null;
    setEnhanced(null);
    const img = imgRef.current;
    if (img) {
      delete img.dataset.mangaFast;
      delete img.dataset.mangaBest;
    }
  }, [wantUpscaleBytes, settings.mangaUpscaleQuality]);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !enhanced) return;
    canvas.getContext("2d")?.drawImage(enhanced, 0, 0);
  }, [enhanced]);

  useEffect(() => {
    if (status !== "error" || autoRetried.current) return;
    autoRetried.current = true;
    const id = window.setTimeout(() => {
      setStatus("loading");
      setBust((b) => b + 1);
    }, 1500);
    return () => window.clearTimeout(id);
  }, [status]);

  useEffect(() => {
    if (!nativeFetch) return;
    let alive = true;
    let created: string | null = null;
    setStatus("loading");
    fetchImageObjectUrl(url, wantHeaderFetch && headers ? headers : IMAGE_FALLBACK_HEADERS)
      .then((obj) => {
        if (!alive) {
          URL.revokeObjectURL(obj);
          return;
        }
        created = obj;
        setBlobUrl(obj);
      })
      .catch(() => {
        if (!alive) return;
        if (wantHeaderFetch) failHeaders();
        else setStatus("error");
      });
    return () => {
      alive = false;
      if (created) URL.revokeObjectURL(created);
    };
  }, [url, headers, nativeFetch, wantHeaderFetch, bust]);

  const rawSrc = bust ? `${url}${url.includes("?") ? "&" : "?"}h=${bust}` : url;
  const src = nativeFetch ? blobUrl : rawSrc;
  const imageTarget = useContextTarget<HTMLImageElement>(() => ({
    kind: "content",
    label: t("Manga page"),
    // Header-authorized images stay tied to the bytes this reader already owns.
    // Never add source headers or a private server URL to generic image metadata.
    image: src ? { src, label: t("Manga page") } : undefined,
  }));

  const retry = () => {
    setStatus("loading");
    setBust((b) => b + 1);
  };

  const loaded = status === "loaded";

  const handleLoad = (event: React.SyntheticEvent<HTMLImageElement>) => {
    setStatus("loaded");
    const img = event.currentTarget;
    imgRef.current = img;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    noteRenderedPageWidth(img.getBoundingClientRect().width * dpr);
    setLoadedTick((n) => n + 1);
  };

  // Uncached pages start one viewport early so they are usually sharp before
  // they scroll in. The delay only skips work while the reader is mid-scroll.
  useEffect(() => {
    const img = imgRef.current;
    if (!wantUpscaleBytes || status !== "loaded" || !img) return;

    let timer = 0;
    let near = false;

    const eligible = () => {
      const rendered = img.getBoundingClientRect().width;
      const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
      // WebGPU handles a double-page spread in about a second; the CPU fallback does not.
      const maxPixels = mangaUpscaleProvider() === "webgpu" ? MAX_GPU_PAGE_PIXELS : undefined;
      const decision = shouldUpscale({
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
        renderedWidth: rendered,
        dpr,
        maxPixels,
      });
      if (import.meta.env.DEV)
        console.info("[manga-upscale]", {
          natural: `${img.naturalWidth}x${img.naturalHeight}`,
          rendered: Math.round(rendered),
          dpr: Math.round(dpr * 100) / 100,
          upscale: decision,
        });
      return decision;
    };

    const run = (cacheOnly = false) => {
      timer = 0;
      const wantsBest = settings.mangaUpscaleQuality === "best";
      if (wantsBest ? img.dataset.mangaBest === "1" : img.dataset.mangaFast === "1") return;

      const token = ++enhanceToken.current;
      const show = async (blob: Blob, quality: "fast" | "best") => {
        const result = await createImageBitmap(blob);
        if (token !== enhanceToken.current) {
          result.close();
          return;
        }
        if (quality === "fast") img.dataset.mangaFast = "1";
        else img.dataset.mangaBest = "1";
        enhancedRef.current?.close();
        enhancedRef.current = result;
        setEnhanced(result);
        if (import.meta.env.DEV)
          console.info(`[manga-upscale] ${quality} overlay`, result.width, result.height);
      };

      void (async () => {
        let bitmap: ImageBitmap | null = null;
        try {
          if (wantsBest) {
            const best = await cachedBestPage(cacheId);
            if (best) {
              noteMangaPageHeight(img.naturalHeight);
              await show(best, "best");
              return;
            }
            // A cached fast result is a placeholder until the best pass runs.
            const fast = await cachedMangaPage(cacheId);
            if (fast) await show(fast, "fast");
            if (cacheOnly) return;
            if (!eligible()) return;

            const source = await readableBlob(img, url, headersRef.current);
            if (!source || !near) return;
            if (await isColorPage(source)) {
              if (import.meta.env.DEV)
                console.info("[manga-upscale] color page, using the fast model");
              if (fast) {
                await show(fast, "fast");
                return;
              }
              bitmap = await createImageBitmap(source);
              const blob = await upscaleMangaPage(cacheId, bitmap);
              bitmap = null;
              await show(blob, "fast");
              return;
            }

            // Only a B&W page can use MangaJaNai; color pages must not skew the
            // height suggestion in Settings.
            noteMangaPageHeight(img.naturalHeight);
            const height = chapterBestHeight(img.naturalHeight);
            if (!(await bestModelInstalled(height))) {
              if (settings.mangaUpscaleAutoDownload) {
                if (import.meta.env.DEV)
                  console.info("[manga-upscale] downloading missing model", height);
                // Keep the fast page on screen while the taller model fetches.
                if (!fast) {
                  bitmap = await createImageBitmap(source);
                  const blob = await upscaleMangaPage(cacheId, bitmap);
                  bitmap = null;
                  await show(blob, "fast");
                }
                try {
                  await downloadBestModel(height);
                } catch (error) {
                  if (import.meta.env.DEV)
                    console.warn("[manga-upscale] model download failed", error);
                  return;
                }
                if (token !== enhanceToken.current) return;
                const bestBlob = await upscaleBestPage(cacheId, source, height);
                await show(bestBlob, "best");
                return;
              }
              if (import.meta.env.DEV)
                console.info(
                  "[manga-upscale] no high-quality model for",
                  height,
                  "- using the fast model",
                );
              if (!fast) {
                bitmap = await createImageBitmap(source);
                const blob = await upscaleMangaPage(cacheId, bitmap);
                bitmap = null;
                await show(blob, "fast");
              }
              return;
            }
            if (token !== enhanceToken.current) return;
            const bestBlob = await upscaleBestPage(cacheId, source, height);
            await show(bestBlob, "best");
            return;
          }

          const fast = await cachedMangaPage(cacheId);
          if (fast) {
            await show(fast, "fast");
            return;
          }
          if (cacheOnly) return;
          if (!eligible()) return;

          const source = await readableBlob(img, url, headersRef.current);
          if (!source || !near) return;
          bitmap = await createImageBitmap(source);
          const blob = await upscaleMangaPage(cacheId, bitmap);
          bitmap = null;
          await show(blob, "fast");
        } catch (error) {
          // Best effort: the original page stays on screen.
          if (import.meta.env.DEV) console.warn("[manga-upscale] upscale failed", error);
          bitmap?.close();
        }
      })();
    };

    const observer = new IntersectionObserver(
      (entries) => {
        near = entries.some((entry) => entry.isIntersecting);
        if (near) {
          if (!timer) timer = window.setTimeout(() => run(false), 300);
        } else if (timer) {
          window.clearTimeout(timer);
          timer = 0;
        }
      },
      { rootMargin: "100%", threshold: 0 },
    );
    observer.observe(img);

    // Zooming or resizing can make an already-loaded page worth upscaling.
    const resizeObserver = new ResizeObserver(() => {
      if (near && !timer) timer = window.setTimeout(() => run(false), 300);
    });
    resizeObserver.observe(img);

    // Apply an already cached result immediately, even off screen, so pages are
    // sharp before they scroll into view. Only uncached pages wait for visibility.
    void run(true);

    const onCached = (event: Event) => {
      const detail = (event as CustomEvent<{ key?: string }>).detail;
      if (detail?.key === cacheId) void run(true);
    };
    window.addEventListener(MANGA_PAGE_CACHED_EVENT, onCached);

    return () => {
      observer.disconnect();
      resizeObserver.disconnect();
      window.removeEventListener(MANGA_PAGE_CACHED_EVENT, onCached);
      if (timer) window.clearTimeout(timer);
    };
  }, [
    url,
    cacheId,
    wantUpscaleBytes,
    status,
    loadedTick,
    settings.mangaUpscaleQuality,
    settings.mangaUpscaleAutoDownload,
  ]);

  return (
    <div
      className={
        inline
          ? "relative my-auto flex justify-center"
          : fillHeight
            ? "relative flex h-full items-center justify-center"
            : "relative flex w-full justify-center"
      }
      style={
        loaded
          ? undefined
          : fillHeight
            ? { minWidth: "36vw" }
            : { minHeight: "60vh", ...(inline ? { minWidth: "28vw" } : {}) }
      }
    >
      {src && (
        <img
          ref={imageTarget}
          key={src}
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          referrerPolicy="no-referrer"
          onLoad={handleLoad}
          onError={() => {
            if (wantHeaderFetch) failHeaders();
            else if (isTauri && !nativeFallback) setNativeFallback(true);
            else setStatus("error");
          }}
          className={`${className ?? ""} transition-opacity duration-500 ${loaded ? "opacity-100" : "opacity-0"}`}
          style={style}
        />
      )}
      {enhanced && (
        <canvas
          ref={canvasRef}
          width={enhanced.width}
          height={enhanced.height}
          aria-hidden
          className={`${className ?? ""} pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2`}
          style={style}
        />
      )}
      {status === "loading" && (
        <div className="pointer-events-none absolute inset-0 animate-pulse bg-gradient-to-b from-elevated/50 to-elevated/20" />
      )}
      {status === "error" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-canvas/60 text-center backdrop-blur-sm">
          <span className="text-[13px] font-medium text-ink-muted">{t("Page failed to load")}</span>
          <button
            type="button"
            onClick={retry}
            className="flex h-10 items-center gap-2 rounded-full border border-edge-soft bg-surface px-4 text-[13px] font-semibold text-ink-muted shadow-[0_2px_8px_-4px_rgba(15,15,18,0.22)] transition-all hover:-translate-y-px hover:border-edge hover:text-ink"
          >
            <RefreshCw size={15} strokeWidth={2.2} />
            {t("Retry")}
          </button>
        </div>
      )}
    </div>
  );
}
