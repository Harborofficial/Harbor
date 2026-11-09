/** The panel must reflect the current playback, not just the saved queue setting. */
export function episodePanelQueueMode({
  isSeries,
  queueSessionAvailable,
  queuePlaybackEnabled,
}: {
  isSeries: boolean;
  queueSessionAvailable: boolean;
  queuePlaybackEnabled: boolean;
}) {
  return {
    // Normal series playback should always show its episodes by default.
    followQueue: isSeries && queuePlaybackEnabled,
    // Keep the selector when an explicitly queued entry switches to "This show".
    canChooseQueue: isSeries && (queueSessionAvailable || queuePlaybackEnabled),
  };
}
