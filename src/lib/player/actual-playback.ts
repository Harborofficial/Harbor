import type { ActualPlayback, PlaybackActor } from "../playback-history";
import type { PlayerSrc } from "../view";
import type { PlayerSnapshot } from "./bridge";
import { isLivePlaybackSrc } from "./live-src";
import { isNaturalEnd } from "./playback-end";
import { playbackAudioChoice } from "./audio-choice";
import { playbackSubtitleChoice, type PlaybackSubtitleChoice } from "./subtitle-choice";
import {
  subtitleMediaKey,
  subtitleStreamKey,
  type RememberedSub,
} from "../subtitles/subtitle-memory";

export function actualPlaybackSnapshot(
  src: PlayerSrc,
  snapshot: PlayerSnapshot,
  positionSec: number,
  session: { id: string; actor: PlaybackActor },
  at = Date.now(),
  rememberedSubtitle?: RememberedSub | null,
): ActualPlayback | null {
  if (
    isLivePlaybackSrc(src) ||
    !snapshot.firstFrameReady ||
    !["playing", "paused", "ended"].includes(snapshot.status) ||
    !Number.isFinite(positionSec) ||
    positionSec <= 0 ||
    !src.meta.id ||
    !src.url
  )
    return null;
  // Runtime-only handles cannot survive restarting Harbor. Keep the original
  // source identity and send proxy/torrent sources through normal preparation.
  const {
    continuation: _continuation,
    playbackTraceId: _trace,
    proxySessionId,
    attempt: _attempt,
    autoFired: _auto,
    startPositionMs: _start,
    startPaused: _paused,
    startFromZero: _zero,
    subtitlePreselect: _initialSubtitle,
    ...saved
  } = src;
  const { videos: _videos, description: _description, ...meta } = src.meta;
  const selectedAudio = snapshot.audioTracks.find((track) => track.selected);
  const selectedSubtitle = snapshot.subtitleTracks.find((track) => track.selected);
  const tracksClearedAtEnd =
    snapshot.status === "ended" &&
    snapshot.audioTracks.length === 0 &&
    snapshot.subtitleTracks.length === 0;
  const subtitle: PlaybackSubtitleChoice | undefined = selectedSubtitle
    ? playbackSubtitleChoice(selectedSubtitle, rememberedSubtitle, {
        mediaKey: subtitleMediaKey(src.meta.id, src.episode?.season, src.episode?.episode),
        streamKey: subtitleStreamKey(src.streamRef),
      })
    : snapshot.status === "ended" && snapshot.subtitleTracks.length === 0
      ? undefined
      : { off: true };
  if (subtitle?.source) subtitle.streamKey = subtitleStreamKey(src.streamRef);
  if (
    subtitle &&
    selectedSubtitle &&
    Number.isFinite(snapshot.subtitleFps) &&
    (snapshot.subtitleFps === 0 || (snapshot.subtitleFps! >= 1 && snapshot.subtitleFps! <= 240))
  )
    subtitle.fpsOverride = snapshot.subtitleFps;
  return {
    ...session,
    playedAt: at,
    positionMs: Math.round(positionSec * 1000),
    durationMs: Math.max(0, Math.round(snapshot.durationSec * 1000)),
    // Watched/progress thresholds do not mean the player finished. A paused
    // near-end session must still continue from its actual position.
    completed: isNaturalEnd(snapshot, positionSec),
    src: { ...saved, meta, url: src.historyUrl ?? src.url },
    requiresSourceRefresh: !!proxySessionId || !!src.streamRef?.infoHash || !!src.homeServer,
    audioTrack: selectedAudio ? playbackAudioChoice(selectedAudio) : undefined,
    subtitle,
    subDelaySec:
      !tracksClearedAtEnd && Number.isFinite(snapshot.subDelaySec)
        ? snapshot.subDelaySec
        : undefined,
    audioDelaySec:
      !tracksClearedAtEnd && Number.isFinite(snapshot.audioDelaySec)
        ? snapshot.audioDelaySec
        : undefined,
  };
}
