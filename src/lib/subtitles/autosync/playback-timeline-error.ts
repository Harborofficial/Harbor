/** Keep native verification failures distinct without exposing source URLs or paths. */
export function playbackTimelineFailure(error: unknown): { code: string; message: string } | null {
  const raw = error instanceof Error ? error.message : String(error);
  const code = raw.match(/\bcache-(?:audio-timeline|subtitle)-[a-z-]+\b/)?.[0];
  if (!code) return null;
  const messages: Record<string, string> = {
    "cache-subtitle-timeout":
      "Reading embedded subtitle timings from the playback cache timed out.",
    "cache-subtitle-track-ambiguous":
      "The playback cache does not contain exactly one embedded subtitle track. Turn off secondary subtitles and let more dialogue buffer before retrying.",
    "cache-subtitle-invalid": "The embedded subtitle timestamps could not be read reliably.",
    "cache-subtitle-read-failed":
      "Harbor could not decode the embedded subtitle timings from the playback cache.",
    "cache-subtitle-insufficient":
      "Too few embedded subtitle timings are buffered. Let a dialogue scene play, then try again.",
    "cache-audio-timeline-timeout": "Verifying the buffered audio against the source timed out.",
    "cache-audio-timeline-cache-timeout":
      "Reading timestamps from the local playback cache timed out.",
    "cache-audio-timeline-source-timeout":
      "Opening or seeking the source stream to verify buffered audio timestamps timed out.",
    "cache-audio-timeline-probe-failed":
      "Harbor could not read packet timestamps for the audio verification.",
    "cache-audio-timeline-invalid":
      "The audio verification returned missing or unsupported timestamp data.",
    "cache-audio-timeline-unverified":
      "The two buffered audio excerpts could not establish consistent timing. Try again after more audio has buffered.",
    "cache-audio-timeline-discontinuous":
      "The cached audio timestamps contain gaps or disagree between excerpts.",
  };
  return {
    code,
    message: `${messages[code] ?? "Harbor could not verify the buffered audio timeline."} No correction was applied.`,
  };
}
