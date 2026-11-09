export type OpenProfileOptions = {
  isMyProfile?: boolean;
};

const listeners = new Set<(handle: string, options?: OpenProfileOptions) => void>();

let pendingEditHandle: string | null = null;
let destination: (() => string | null) | null = null;

/** The navigation owner supplies the current top destination, never account identity. */
export function registerProfileDestination(read: () => string | null): () => void {
  destination = read;
  return () => {
    if (destination === read) destination = null;
  };
}

export function canOpenProfile(handle: string, options?: { fromOverlay?: boolean }): boolean {
  const target = handle.trim().toLowerCase();
  return (
    !!target && (options?.fromOverlay === true || destination?.()?.trim().toLowerCase() !== target)
  );
}

export function requestOpenProfile(handle: string, options?: OpenProfileOptions): void {
  const h = handle.trim().toLowerCase();
  if (!h) return;
  for (const l of listeners) l(h, options);
}

export function subscribeOpenProfile(
  cb: (handle: string, options?: OpenProfileOptions) => void,
): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function requestEditProfile(handle: string): void {
  const h = handle.trim().toLowerCase();
  if (!h) return;
  pendingEditHandle = h;
  requestOpenProfile(h, { isMyProfile: true });
}

export function consumeProfileEditIntent(handle: string): boolean {
  const h = handle.trim().toLowerCase();
  if (pendingEditHandle && pendingEditHandle === h) {
    pendingEditHandle = null;
    return true;
  }
  return false;
}
