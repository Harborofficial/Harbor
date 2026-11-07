import { invoke } from "@tauri-apps/api/core";

// Never use a media URL or subtitle text as a native job identifier.
let nextSession = 0;
export function newAnalysisSessionId(): string {
  nextSession += 1;
  return `subsync-${Date.now().toString(36)}-${nextSession.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Cancel the *native* analysis, including kill-on-drop FFmpeg children. */
export function cancelNativeAnalysis(sessionId: string): void {
  void invoke("subsync_cancel_session", { sessionId }).catch(() => {});
}
