import { Spinner } from "@/components/spinner";
import { useEffect, useRef, useState } from "react";
import {
  useThumbnailSession,
  thumbCacheGet,
  thumbCacheReceivedAt,
  thumbCacheNearest,
  subscribeThumbnails,
  trickplayGet,
  trickplayPrefetchHover,
} from "@/lib/trickplay";
import { seekrRefresh, seekrTileAt, useSeekrState, type SeekrTile } from "@/lib/seekr";
import { useSkipSegmentsView } from "@/lib/skip-intro/segment-store";
import { useT } from "@/lib/i18n";

const SEG_LABEL = { intro: "OP", outro: "ED", recap: "Recap", ad: "Ad" } as const;
const BUCKET_SECONDS = 2;
const CARD_WIDTH = 192;
const CARD_HEIGHT = 108;
const REQUEST_TIMEOUT_MS = 15000;
const SETTLE_MS = 70;
// A sparse timeline frame is provisional; the timestamp remains the exact seek target.
const NEAREST_WINDOW = 15;

function traceThumbnail(stage: string, details: Record<string, number | boolean>): void {
  if (import.meta.env.DEV) {
    console.info(`[harbor/thumbs-ui] ${stage} ${JSON.stringify(details)}`);
  }
}

export function ThumbPreview({
  time,
  dur,
  canFetch = true,
}: {
  time: number;
  dur: number;
  canFetch?: boolean;
}) {
  const bucket = Math.round(time / BUCKET_SECONDS);
  const liveBucketRef = useRef(bucket);
  liveBucketRef.current = bucket;
  const session = useThumbnailSession();
  const seekr = useSeekrState();
  const seekrTile = seekr.status === "active" ? seekrTileAt(time) : null;
  const timingRef = useRef({ bucket, session, started: performance.now() });
  if (timingRef.current.bucket !== bucket || timingRef.current.session !== session) {
    timingRef.current = { bucket, session, started: performance.now() };
  }
  const [, refresh] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const cached = thumbCacheGet(bucket);
    if (cached) {
      setLoading(false);
      if (canFetch) void trickplayPrefetchHover(bucket * BUCKET_SECONDS);
      return;
    }
    if (!canFetch) {
      setLoading(false);
      return;
    }
    setLoading(true);
    let cancelled = false;
    let timeout = 0;
    const unsubscribe = subscribeThumbnails((readyBucket) => {
      if (cancelled || liveBucketRef.current !== bucket) return;
      if (Math.abs(readyBucket - bucket) <= NEAREST_WINDOW) refresh((value) => value + 1);
      if (readyBucket === bucket) {
        if (import.meta.env.DEV)
          traceThumbnail("received", {
            targetSec: bucket * BUCKET_SECONDS,
            ready: !!thumbCacheGet(bucket),
            elapsedMs: Math.round(performance.now() - timingRef.current.started),
          });
        setLoading(false);
        window.clearTimeout(timeout);
      }
    });
    const timer = window.setTimeout(() => {
      if (import.meta.env.DEV)
        traceThumbnail("request", {
          targetSec: bucket * BUCKET_SECONDS,
        });
      timeout = window.setTimeout(() => {
        setLoading(false);
        if (import.meta.env.DEV)
          traceThumbnail("timeout", {
            targetSec: bucket * BUCKET_SECONDS,
            elapsedMs: Math.round(performance.now() - timingRef.current.started),
          });
      }, REQUEST_TIMEOUT_MS);
      void trickplayGet(bucket * BUCKET_SECONDS).then((url) => {
        if (cancelled || liveBucketRef.current !== bucket) return;
        if (url) {
          refresh((value) => value + 1);
          setLoading(false);
          window.clearTimeout(timeout);
        }
        void trickplayPrefetchHover(bucket * BUCKET_SECONDS);
      });
    }, SETTLE_MS);
    return () => {
      cancelled = true;
      unsubscribe();
      window.clearTimeout(timer);
      window.clearTimeout(timeout);
    };
  }, [bucket, canFetch, session]);

  const t = useT();
  const segments = useSkipSegmentsView();
  const seg = segments.find((s) => time >= s.startSec && time < s.endSec);
  const segLabel = seg ? t(SEG_LABEL[seg.kind]) : null;
  const pct = (time / dur) * 100;
  const label = fmtTime(time);
  const exact = thumbCacheGet(bucket);
  const nearest = exact ? null : thumbCacheNearest(bucket, NEAREST_WINDOW);
  const src = exact ?? nearest ?? null;
  const approx = !exact && !!nearest;

  if (!seekrTile && !src && !loading) {
    return (
      <div
        className="pointer-events-none absolute -top-9 flex -translate-x-1/2 items-center gap-1 rounded-md border border-white/10 bg-black/90 px-2 py-1 font-mono text-[12px] font-semibold tabular-nums text-white shadow-lg backdrop-blur-md"
        style={{ left: `${pct}%` }}
      >
        {segLabel && (
          <span className="rounded bg-accent px-1 font-sans text-[10px] font-bold uppercase tracking-wide text-canvas">
            {segLabel}
          </span>
        )}
        {label}
      </div>
    );
  }

  return (
    <div
      className="pointer-events-none absolute -translate-x-1/2"
      style={{ left: `${pct}%`, bottom: "calc(100% + 8px)" }}
    >
      <div
        className="relative overflow-hidden rounded-lg border border-white/10 bg-black/85 shadow-[0_18px_40px_-15px_rgba(0,0,0,0.7)] backdrop-blur-md"
        style={{ width: CARD_WIDTH, height: CARD_HEIGHT }}
      >
        {seekrTile ? (
          <SeekrSprite tile={seekrTile} width={CARD_WIDTH} height={CARD_HEIGHT} />
        ) : src ? (
          <img
            src={src}
            alt=""
            draggable={false}
            onLoad={() => {
              if (!import.meta.env.DEV || !exact) return;
              const timing = timingRef.current;
              const received = thumbCacheReceivedAt(bucket);
              if (timing.bucket !== bucket || timing.session !== session || received === undefined)
                return;
              const loaded = performance.now();
              // The second animation frame is a paint opportunity, not proof of
              // the compositor displaying a pixel. Keep that distinction in logs.
              requestAnimationFrame(() =>
                requestAnimationFrame(() => {
                  if (timingRef.current !== timing) return;
                  traceThumbnail("display", {
                    targetSec: bucket * BUCKET_SECONDS,
                    cached: received < timing.started,
                    requestToReceiptMs: Math.round(Math.max(0, received - timing.started)),
                    receiptToImageLoadMs: Math.round(loaded - Math.max(received, timing.started)),
                    requestToPaintOpportunityMs: Math.round(performance.now() - timing.started),
                  });
                }),
              );
            }}
            onError={() => {
              if (import.meta.env.DEV)
                traceThumbnail("image-load-failed", {
                  targetSec: bucket * BUCKET_SECONDS,
                });
            }}
            className={`h-full w-full object-cover transition-opacity duration-100 ${
              approx ? "opacity-60" : "opacity-100"
            }`}
          />
        ) : (
          <div className="h-full w-full bg-gradient-to-br from-white/5 to-transparent" />
        )}
        <div
          className={`absolute inset-0 flex items-center justify-center transition-opacity duration-150 ${
            loading && !seekrTile && !src ? "opacity-100" : "opacity-0"
          }`}
        >
          <Spinner size={20} className="text-white/70" />
        </div>
      </div>
      <div className="mt-1 flex items-center justify-center gap-1">
        {segLabel && (
          <span className="rounded bg-accent px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-canvas">
            {segLabel}
          </span>
        )}
        <span className="inline-block rounded-md bg-black/85 px-1.5 py-0.5 font-mono text-[11px] text-white">
          {label}
        </span>
      </div>
    </div>
  );
}

function SeekrSprite({ tile, width, height }: { tile: SeekrTile; width: number; height: number }) {
  const scale = width / tile.w;
  return (
    <div className="relative overflow-hidden" style={{ width, height }}>
      <img
        src={tile.url}
        alt=""
        draggable={false}
        decoding="async"
        onError={() => seekrRefresh()}
        style={{
          position: "absolute",
          left: -tile.x * scale,
          top: -tile.y * scale,
          width: "auto",
          height: "auto",
          maxWidth: "none",
          maxHeight: "none",
          transform: `scale(${scale})`,
          transformOrigin: "top left",
        }}
      />
    </div>
  );
}

function fmtTime(t: number): string {
  if (!Number.isFinite(t) || t < 0) return "0:00";
  const total = Math.floor(t);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
