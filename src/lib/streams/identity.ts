import type { Stream } from "./types";

export function streamKey(s: Stream): string | Stream {
  // A hash identifies a torrent, not a provider's playback endpoint. In particular,
  // season-pack URLs can select different episodes without exposing fileIdx.
  if (s.url)
    return JSON.stringify(["url", s.url, s.behaviorHints?.proxyHeaders, s.behaviorHints?.headers]);
  if (s.infoHash)
    return JSON.stringify(["hash", s.infoHash.toLowerCase(), s.fileIdx, s.fileMustInclude]);
  if (s.ytId) return `youtube:${s.ytId}`;
  if (s.externalUrl) return `external:${s.externalUrl}`;
  // Without a known playback identity, there is no evidence these are duplicates.
  return s;
}
