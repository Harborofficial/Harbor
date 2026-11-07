let pending = false;
const listeners = new Set<() => void>();

/** Ask the Theme tab to open the custom color editor. */
export function requestThemeEditor(): void {
  pending = true;
  for (const listener of listeners) listener();
}

/** Returns true once after a request; used when the editor mounts later. */
export function consumeThemeEditorRequest(): boolean {
  const value = pending;
  pending = false;
  return value;
}

export function subscribeThemeEditorRequest(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
