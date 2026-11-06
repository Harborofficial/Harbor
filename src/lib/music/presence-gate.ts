import type { MusicPlayerState } from "./types";

/** A restored paused checkpoint is not an active listening session. */
export function shouldPublishMusicPresence(
  state: Pick<MusicPlayerState, "current" | "phase">,
  startedThisSession: boolean,
): boolean {
  if (!state.current) return false;
  if (state.phase === "idle" || state.phase === "error") return false;
  if (state.phase === "resolving") return false;
  return state.phase === "playing" || startedThisSession;
}
