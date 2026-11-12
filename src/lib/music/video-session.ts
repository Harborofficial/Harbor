import {
  activateMusicVideo,
  getMusicState,
  isMusicVideoActive,
  subscribeMusic,
  waitForMusicAudioReady,
} from "./player";
import { musicVideoStream, musicVideoStreamKey } from "./video";
import { primeMusicVideoHostPosition, releaseMusicVideoHostSource } from "./video-host";
import { createMusicVideoSurfaces, type HoldVideo } from "./video-surfaces";
import type { MusicTrack } from "./types";

/**
 * Leaving the watch page unmounts every surface, but the picture is a parked media element
 * rather than anything a screen owns, so the song simply keeps playing. Nothing bounds the gap:
 * the session ends when the music player stops treating this video as what is playing, which is
 * the only moment the picture has stopped being the thing the listener is hearing.
 */
const holdMusicVideo: HoldVideo = (release) => {
  const unsubscribe = subscribeMusic(() => {
    if (!isMusicVideoActive()) release();
  });
  if (!isMusicVideoActive()) release();
  return unsubscribe;
};

/** A picture the native side can resolve on its own. A catalog id has no provider to ask. */
function resolvableVideo(track: MusicTrack | null | undefined): track is MusicTrack {
  if (!track?.connectorId || track.connectorId === "catalog") return false;
  // YouTube audio tracks still have a video behind them, so warming those too makes opening the
  // picture pane a cache hit instead of another extractor run.
  return track.connectorId === "youtube"
    ? !!track.sourceId || !!track.id
    : track.mediaKind === "video";
}

/**
 * Resolution runs yt-dlp and costs seconds, and the song is audible for every one of them
 * because the engine loads with no pause set. Starting it when the track becomes current puts
 * the whole resolve alongside the audio load: playMusic publishes the new track before it
 * loads anything, so by the time a surface asks for the stream it is usually already cached.
 */
let warmedKey = "";
function warmMusicVideoStream(track: MusicTrack | null | undefined): void {
  if (!resolvableVideo(track)) return;
  const key = musicVideoStreamKey(track);
  if (key === warmedKey) return;
  warmedKey = key;
  void musicVideoStream(track).catch(() => {});
}

subscribeMusic(() => warmMusicVideoStream(getMusicState().current));

export const musicVideoSurfaces = createMusicVideoSurfaces(async (track, signal) => {
  let controls: Awaited<ReturnType<typeof activateMusicVideo>> | undefined;
  let closing: Promise<void> | undefined;
  const close = () => {
    closing ??= (async () => {
      releaseMusicVideoHostSource(musicVideoStreamKey(track));
      await controls?.release();
    })();
    return closing;
  };
  signal.addEventListener("abort", close, { once: true });
  if (signal.aborted) {
    await close();
    return;
  }
  try {
    const primed = waitForMusicAudioReady(track);
    await musicVideoStream(track);
    if (signal.aborted) return;
    if (!(await primed)) throw new Error("Music source did not become ready");
    if (signal.aborted) return;
    controls = await activateMusicVideo(track.id);
    primeMusicVideoHostPosition(musicVideoStreamKey(track), controls.position);
    if (signal.aborted) await close();
  } catch (error) {
    await close();
    throw error;
  }
}, holdMusicVideo);
