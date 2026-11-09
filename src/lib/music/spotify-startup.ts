/** A successful Spotify play command only queues audio. Wait for an actual player event. */
export const SPOTIFY_STARTUP_TIMEOUT_MS = 35_000;

export const SPOTIFY_STARTUP_TIMEOUT_MESSAGE =
  "Spotify accepted the song, but playback did not start within 35 seconds. " +
  "Try another track or playback device; check the Harbor logs for Spotify audio-key or network errors.";

type TrackIdentity = { id: string; connectorId?: string | null };

export function shouldReportSpotifyStartupTimeout(input: {
  request: number;
  currentRequest: number;
  expected: TrackIdentity;
  current: TrackIdentity | null;
  phase: string;
  casting: boolean;
  videoOwned: boolean;
}): boolean {
  return (
    input.request === input.currentRequest &&
    input.expected.connectorId === "spotify" &&
    input.current?.id === input.expected.id &&
    input.current?.connectorId === input.expected.connectorId &&
    input.phase === "resolving" &&
    !input.casting &&
    !input.videoOwned
  );
}
