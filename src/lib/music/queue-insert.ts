import type { MusicTrack } from "./types";
import { queueTrackKey } from "./queue-order";

const manual = new Set<string>();

export function markManuallyQueued(track: MusicTrack): void {
  manual.add(queueTrackKey(track));
}

export function forgetManuallyQueued(track: MusicTrack): void {
  manual.delete(queueTrackKey(track));
}

export function manualBlockEnd(
  queue: MusicTrack[],
  currentIndex: number,
  isManual: (track: MusicTrack) => boolean,
): number {
  const start = currentIndex < 0 ? 0 : currentIndex + 1;
  let at = start;
  while (at < queue.length && isManual(queue[at])) at += 1;
  return at;
}

export function queueInsertIndex(queue: MusicTrack[], currentIndex: number): number {
  return manualBlockEnd(queue, currentIndex, (track) => manual.has(queueTrackKey(track)));
}

export function insertIntoQueue(queue: MusicTrack[], track: MusicTrack, at: number): MusicTrack[] {
  if (queue.some((item) => queueTrackKey(item) === queueTrackKey(track))) return queue;
  const index = Math.max(0, Math.min(at, queue.length));
  return [...queue.slice(0, index), track, ...queue.slice(index)];
}

/**
 * Add to queue: the track joins the manual block after the current song. A
 * track already sitting elsewhere in the collection is moved into that block
 * instead of duplicated, so queueing from the collection's own queue works.
 */
export function queueInsertAfterManualBlock(
  queue: MusicTrack[],
  track: MusicTrack,
  currentIndex: number,
): MusicTrack[] {
  const key = queueTrackKey(track);
  const at = queue.findIndex((item) => queueTrackKey(item) === key);
  if (at >= 0 && at === currentIndex) return queue;
  const isManual = (item: MusicTrack) => manual.has(queueTrackKey(item));
  const start = currentIndex < 0 ? 0 : currentIndex + 1;
  if (at >= start && at < manualBlockEnd(queue, currentIndex, isManual)) return queue;
  const without = at >= 0 ? queue.filter((_, index) => index !== at) : queue;
  const current = currentIndex >= 0 ? queue[currentIndex] : undefined;
  const currentAfter = current
    ? without.findIndex((item) => queueTrackKey(item) === queueTrackKey(current))
    : -1;
  return insertIntoQueue(without, track, manualBlockEnd(without, currentAfter, isManual));
}

/**
 * Play next: the track goes directly after the current one, ahead of songs that
 * were queued earlier. An existing copy is moved instead of duplicated.
 */
export function withTrackNext(
  queue: MusicTrack[],
  track: MusicTrack,
  currentIndex: number,
): MusicTrack[] {
  const key = queueTrackKey(track);
  const current = currentIndex >= 0 ? queue[currentIndex] : undefined;
  if (current && queueTrackKey(current) === key) return queue;
  const without = queue.filter((item) => queueTrackKey(item) !== key);
  const currentAfter =
    current === undefined
      ? -1
      : without.findIndex((item) => queueTrackKey(item) === queueTrackKey(current));
  const at = currentAfter >= 0 ? currentAfter + 1 : 0;
  return [...without.slice(0, at), track, ...without.slice(at)];
}
