import type { TrackInfo } from "./bridge";
import {
  lookupSubtitleOrigin,
  rememberedFromChoice,
  type RememberedSub,
} from "../subtitles/subtitle-memory";
import { normalizeLang } from "../subtitles/language";
import { selectedSubtitleCacheName } from "../subtitles/selected-subtitle-cache";
import { playbackTransportFingerprint } from "./playback-history-source";

export type PlaybackSubtitleChoice = Omit<RememberedSub, "updatedAt"> & {
  external?: boolean;
  codec?: string;
  forced?: boolean;
  hearingImpaired?: boolean;
  fpsOverride?: number;
  homeServerSubtitleId?: string;
  sourceFingerprint?: string;
};

function durableSource(source?: string): string | undefined {
  const original = source && (lookupSubtitleOrigin(source) ?? source);
  return original && !/^(blob|data|memory):/i.test(original) ? original : undefined;
}

function sameSource(source: string | undefined, saved: string): boolean {
  return durableSource(source)?.replace(/\\/g, "/") === durableSource(saved)?.replace(/\\/g, "/");
}

type SubtitleCacheContext = { mediaKey: string; streamKey?: string };

function matchesCachedSubtitleOrigin(
  choice: Pick<PlaybackSubtitleChoice, "subId" | "provider" | "sourceFingerprint">,
  source: string | undefined,
  remembered?: RememberedSub | null,
  context?: SubtitleCacheContext,
): boolean {
  const file = remembered?.source?.split(/[\\/]/).pop() ?? "";
  const format = /^selected-[a-f0-9]{8}\.(srt|vtt|ass|ssa)$/i.exec(file)?.[1]?.toLowerCase() as
    | "srt"
    | "vtt"
    | "ass"
    | "ssa"
    | undefined;
  if (
    !context ||
    !remembered?.imported ||
    remembered.off ||
    !format ||
    !/^(?:[a-z]:[\\/]|[\\/]|file:\/\/)/i.test(remembered.source ?? "") ||
    remembered.streamKey !== context.streamKey ||
    remembered.subId !== choice.subId ||
    remembered.provider !== choice.provider
  )
    return false;

  // An exact origin URL can verify the managed cache filename. Redacted
  // histories instead prove the same origin using its SHA-256 fingerprint,
  // captured when the remote subtitle was copied into the local cache.
  if (source)
    return (
      file ===
      selectedSubtitleCacheName(context.mediaKey, context.streamKey, { ...choice, source }, format)
    );
  return (
    !!choice.sourceFingerprint &&
    /^[a-f0-9]{64}$/.test(choice.sourceFingerprint) &&
    remembered.sourceFingerprint === choice.sourceFingerprint
  );
}

/** A late cache may finish after the actual session was flushed on exit. */
export function restorablePlaybackSubtitleChoice(
  saved: PlaybackSubtitleChoice,
  remembered: RememberedSub | null,
  context: SubtitleCacheContext,
): PlaybackSubtitleChoice {
  if (
    !remembered ||
    saved.off ||
    !saved.external ||
    saved.streamKey !== context.streamKey ||
    !matchesCachedSubtitleOrigin(saved, durableSource(saved.source), remembered, context)
  )
    return saved;
  const { updatedAt: _cacheTime, ...cached } = remembered;
  return { ...saved, ...cached, external: true, fpsOverride: saved.fpsOverride };
}

export function playbackSubtitleChoice(
  track: TrackInfo,
  remembered?: RememberedSub | null,
  context?: SubtitleCacheContext,
): PlaybackSubtitleChoice {
  const choice = rememberedFromChoice({
    ...track,
    title: track.title ?? track.label,
    source:
      durableSource(track.originalUrl) ??
      durableSource(track.externalFilename) ??
      durableSource(track.url),
  });
  // A prepared blob is never a persistent subtitle source, even when no origin is known.
  choice.source = durableSource(choice.source);
  const matchesCachedOrigin = matchesCachedSubtitleOrigin(
    track,
    choice.source,
    remembered,
    context,
  );
  const sameRemembered =
    remembered &&
    !remembered.off &&
    (matchesCachedOrigin ||
      (remembered.source &&
        [track.originalUrl, track.externalFilename, track.url].some((source) =>
          sameSource(source, remembered.source!),
        )) ||
      (remembered.subId &&
        remembered.subId === track.subId &&
        remembered.provider === track.provider &&
        (!remembered.lang || normalizeLang(remembered.lang) === normalizeLang(track.lang ?? ""))) ||
      (!track.external &&
        remembered.trackId === track.id &&
        normalizeLang(remembered.lang ?? "") === normalizeLang(track.lang ?? "") &&
        remembered.title === (track.title ?? track.label)));
  return {
    ...(sameRemembered ? { ...remembered, updatedAt: undefined } : choice),
    source: (sameRemembered ? durableSource(remembered?.source) : undefined) ?? choice.source,
    external: track.external || undefined,
    codec: track.codec,
    forced: track.forced,
    hearingImpaired: track.hearingImpaired,
  };
}

export function selectPlaybackSubtitle(
  tracks: TrackInfo[],
  choice: PlaybackSubtitleChoice,
): TrackInfo | null {
  if (choice.off) return null;
  const norm = (value?: string) => (value ?? "").trim().toLowerCase();
  const matches = tracks.filter((track) => {
    if (choice.external) {
      return (
        !!track.external &&
        ((!!choice.source &&
          [track.originalUrl, track.url, track.externalFilename].some((source) =>
            sameSource(source, choice.source!),
          )) ||
          (!choice.source &&
            !!choice.sourceFingerprint &&
            [track.originalUrl, track.url, track.externalFilename].some(
              (source) =>
                playbackTransportFingerprint(durableSource(source)) === choice.sourceFingerprint,
            )) ||
          (!!choice.subId &&
            choice.subId === track.subId &&
            choice.provider === track.provider &&
            (!choice.lang || normalizeLang(choice.lang) === normalizeLang(track.lang ?? ""))))
      );
    }
    return (
      !track.external &&
      normalizeLang(track.lang ?? "") === normalizeLang(choice.lang ?? "") &&
      norm(track.title ?? track.label) === norm(choice.title) &&
      (!choice.codec || norm(track.codec) === norm(choice.codec)) &&
      (choice.forced === undefined || !!track.forced === choice.forced) &&
      (choice.hearingImpaired === undefined || !!track.hearingImpaired === choice.hearingImpaired)
    );
  });
  return matches.length === 1 ? matches[0] : null;
}
