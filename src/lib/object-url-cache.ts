type Entry = { src: string; bytes: number; refs: number; retired: boolean; expires: number };

/** Idle URLs are bounded; mounted images retain their URL until cleanup. */
export function createObjectUrlCache(limit = 64 * 1024 * 1024, maxEntries = 512) {
  const entries = new Map<string, Entry>();
  let bytes = 0;
  function remove(key: string, entry: Entry) {
    entries.delete(key);
    bytes -= entry.bytes;
    entry.retired = true;
    if (!entry.refs) URL.revokeObjectURL(entry.src);
  }
  function prune() {
    for (const [key, entry] of entries) {
      if (bytes <= limit && entries.size <= maxEntries) break;
      if (!entry.refs) remove(key, entry);
    }
  }
  return {
    get(key: string) {
      let entry = entries.get(key);
      if (entry && entry.expires <= Date.now()) {
        remove(key, entry);
        entry = undefined;
      }
      if (entry) {
        entries.delete(key);
        entries.set(key, entry);
      }
      return entry;
    },
    set(key: string, blob: Blob, ttl = 5 * 60_000) {
      const previous = entries.get(key);
      if (previous) remove(key, previous);
      const entry: Entry = {
        src: URL.createObjectURL(blob),
        bytes: blob.size,
        refs: 0,
        retired: false,
        expires: Date.now() + Math.min(5 * 60_000, Math.max(0, ttl)),
      };
      entries.set(key, entry);
      bytes += entry.bytes;
      // Promise consumers acquire their lease before idle eviction runs.
      setTimeout(prune, 0);
      return entry;
    },
    retain(entry: Entry) {
      entry.refs++;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        entry.refs--;
        if (!entry.refs && entry.retired) URL.revokeObjectURL(entry.src);
        prune();
      };
    },
    clear() {
      for (const [key, entry] of entries) remove(key, entry);
    },
    stats: () => ({ bytes, entries: entries.size }),
  };
}
