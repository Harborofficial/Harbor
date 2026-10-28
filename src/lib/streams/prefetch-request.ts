type Entry<T> = {
  controller: AbortController;
  promise: Promise<T>;
  users: number;
  prefetch: boolean;
  expires: number;
  settled: boolean;
};

const entries = new Map<string, Entry<unknown>>();
const TTL_MS = 90_000;

export function clearPrefetchedRequests(): void {
  for (const entry of entries.values()) entry.controller.abort();
  entries.clear();
}

/** Only background answers are retained; foreground requests can adopt in-flight work. */
export async function prefetchRequest<T>(
  key: string,
  signal: AbortSignal,
  prefetch: boolean,
  load: (signal: AbortSignal) => Promise<T>,
  usable: (value: T) => boolean,
): Promise<T> {
  signal.throwIfAborted();
  let entry = entries.get(key) as Entry<T> | undefined;
  if (
    entry &&
    (entry.controller.signal.aborted || (entry.settled && entry.expires <= Date.now()))
  ) {
    entries.delete(key);
    entry = undefined;
  }
  if (!entry) {
    const controller = new AbortController();
    entry = { controller, users: 0, prefetch, expires: 0, settled: false, promise: null! };
    const current = entry;
    entries.set(key, current);
    current.promise = Promise.resolve()
      .then(() => {
        controller.signal.throwIfAborted();
        return load(controller.signal);
      })
      .then(
        (value) => {
          current.settled = true;
          current.expires = Date.now() + TTL_MS;
          if (!current.prefetch || controller.signal.aborted || !usable(value)) {
            if (entries.get(key) === current) entries.delete(key);
          }
          return value;
        },
        (error: unknown) => {
          if (entries.get(key) === current) entries.delete(key);
          throw error;
        },
      );
    // Bound completed prefetch entries even when no foreground picker consumes them.
    for (const [oldKey, old] of entries) {
      if (old.settled && (old.expires <= Date.now() || entries.size > 16)) entries.delete(oldKey);
    }
  }
  const current = entry;
  current.users++;
  let onAbort: () => void = () => {};
  try {
    return await Promise.race([
      current.promise,
      new Promise<never>((_, reject) => {
        onAbort = () => reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
        signal.addEventListener("abort", onAbort, { once: true });
      }),
    ]);
  } finally {
    signal.removeEventListener("abort", onAbort);
    current.users--;
    if (!prefetch && current.settled && entries.get(key) === current) entries.delete(key);
    if (!current.settled && current.users === 0) {
      // Allow the next picker to adopt a request during player teardown.
      setTimeout(() => {
        if (!current.settled && current.users === 0) {
          current.controller.abort();
          if (entries.get(key) === current) entries.delete(key);
        }
      }, 1000);
    }
  }
}
