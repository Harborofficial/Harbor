export const SUBTITLE_PROVIDER_TIMEOUT_MS = 16_000;
// Automatic provider work must not compete with the first seconds of media
// delivery. Explicit selections still load immediately after the first frame.
export const AUTOMATIC_SUBTITLE_BUFFER_SEC = 6;
export const AUTOMATIC_SUBTITLE_MAX_DEFER_MS = 5_000;

export type AutomaticSubtitleGate = {
  ready: boolean;
  reason: "frame" | "buffering" | "buffer" | "ready" | "max_wait";
  waitMs: number | null;
};

export function automaticSubtitleGate(input: {
  engine: "html5" | "mpv";
  firstFrameReady: boolean;
  buffering: boolean;
  bufferedSec: number;
  firstFrameAt: number | null;
  now: number;
}): AutomaticSubtitleGate {
  if (!input.firstFrameReady) return { ready: false, reason: "frame", waitMs: null };
  // HTML5 playback has no equivalent low-level buffer signal here.
  if (input.engine !== "mpv") return { ready: true, reason: "ready", waitMs: null };
  const sinceFrame = Math.max(0, input.now - (input.firstFrameAt ?? input.now));
  // A maximum wait must not start background downloads during an actual stall.
  if (input.buffering) return { ready: false, reason: "buffering", waitMs: null };
  if (sinceFrame >= AUTOMATIC_SUBTITLE_MAX_DEFER_MS) {
    return { ready: true, reason: "max_wait", waitMs: null };
  }
  const remaining = AUTOMATIC_SUBTITLE_MAX_DEFER_MS - sinceFrame;
  if (!Number.isFinite(input.bufferedSec) || input.bufferedSec < AUTOMATIC_SUBTITLE_BUFFER_SEC) {
    return { ready: false, reason: "buffer", waitMs: remaining };
  }
  return { ready: true, reason: "ready", waitMs: null };
}

export function subtitleSearchImdbId(
  imdbId: string | null | undefined,
  verified: boolean,
): string | undefined {
  return verified && imdbId ? imdbId : undefined;
}

export function canStartSubtitleAutoload(input: {
  imdbId: string | null | undefined;
  mediaReady: boolean;
}): boolean {
  return !!input.imdbId && input.mediaReady;
}

export function withSubtitleTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

export async function loadFirstWorkingSubtitle<T>(
  candidates: T[],
  load: (candidate: T) => Promise<boolean>,
  limit = 5,
): Promise<T | null> {
  for (const candidate of candidates.slice(0, Math.max(0, limit))) {
    if (await load(candidate)) return candidate;
  }
  return null;
}
