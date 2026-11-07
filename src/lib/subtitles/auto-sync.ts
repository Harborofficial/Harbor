import { invoke } from "@tauri-apps/api/core";

export type AutoSyncInput = {
  mediaUrl: string;
  headers?: Record<string, string>;
  cues: Array<[number, number]>;
  durationSec: number;
  infoHash?: string | null;
  audioMap?: string;
  sessionId?: string;
  reportFailures?: boolean;
};

export type AutoSyncResult = {
  offsetSec: number;
  ratio: number;
  confidence: number;
  fitWindowIds?: string[];
};

export const AUTO_SYNC_AVAILABLE = true;

export async function estimateSubtitleOffset(input: AutoSyncInput): Promise<AutoSyncResult | null> {
  return invoke<AutoSyncResult | null>("sync_subtitle", {
    url: input.mediaUrl,
    headers: input.headers,
    cues: input.cues,
    durationSec: input.durationSec,
    infoHash: input.infoHash ?? null,
    mapSpec: input.audioMap ?? null,
    sessionId: input.sessionId ?? null,
    reportFailures: input.reportFailures === true,
  });
}
