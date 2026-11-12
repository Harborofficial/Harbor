/** Run one source-local audio probe with a strict JS and native cancellation budget.
 * Native cancellation drops the kill-on-drop FFmpeg child, not just its promise.
 */
export async function boundedNativeProbe<T>(
  run: () => Promise<T>,
  cancel: () => void,
  maxMs: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      run(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          cancel();
          reject(new Error("subsync-scene-timeout"));
        }, maxMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Once the remote verifier failed, trying another direct FFmpeg seek is redundant.
 * A click handler may also supply an event object; only literal true opts in.
 */
export function shouldReadIndependentSceneAudio(
  preferBufferedAudio: unknown,
  url: string,
): boolean {
  return preferBufferedAudio !== true && supportsCurrentSceneRead(url);
}

export function supportsCurrentSceneRead(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    const hostname = parsed.hostname.toLowerCase();
    // Internal stream services are often bound to mpv state and cannot be
    // replayed safely through an unrelated FFmpeg process.
    return (
      hostname !== "localhost" &&
      !hostname.endsWith(".localhost") &&
      !hostname.startsWith("127.") &&
      hostname !== "0.0.0.0" &&
      hostname !== "[::1]" &&
      hostname !== "[::]"
    );
  } catch {
    return false;
  }
}
