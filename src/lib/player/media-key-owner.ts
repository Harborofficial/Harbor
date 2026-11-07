let videoOwns = false;
const ownershipListeners = new Set<(owns: boolean) => void>();

/** The video player and Music both listen for harbor://media-key, so one has to yield. */
export function setVideoOwnsMediaKeys(owns: boolean): void {
  if (videoOwns === owns) return;
  videoOwns = owns;
  for (const listener of ownershipListeners) listener(owns);
}

export function videoOwnsMediaKeys(): boolean {
  return videoOwns;
}

export function subscribeVideoMediaKeyOwner(listener: (owns: boolean) => void): () => void {
  ownershipListeners.add(listener);
  return () => ownershipListeners.delete(listener);
}
