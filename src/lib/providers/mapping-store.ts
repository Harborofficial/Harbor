import { animeDbReadProvider, animeDbWriteProvider } from "@/lib/anime-identity-db";

// Mapping lookups remain synchronous after an asynchronous one-time hydration.
// The provider's async resolution paths await ready before deciding to fetch.
const FLUSH_MS = 600;

export type MappingStore<T> = {
  ready: Promise<void>;
  get(key: string): T | undefined;
  set(key: string, value: T): void;
};

export function mappingStore<T>(storageKey: string): MappingStore<T> {
  const dbKey = `mapping-store:${storageKey}`;
  const fallbackKey = `${storageKey}.pending.v1`;
  let legacy: Record<string, T> = {};
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        legacy = parsed as Record<string, T>;
      }
    }
  } catch {}
  let pendingLegacy: { t: number; m: Record<string, T> } | null = null;
  try {
    const raw = localStorage.getItem(fallbackKey);
    if (raw) {
      const parsed = JSON.parse(raw) as { t?: unknown; m?: unknown };
      if (
        typeof parsed?.t === "number" &&
        parsed.m &&
        typeof parsed.m === "object" &&
        !Array.isArray(parsed.m)
      ) {
        pendingLegacy = { t: parsed.t, m: parsed.m as Record<string, T> };
      }
    }
  } catch {}
  let mem: Record<string, T> = { ...legacy, ...pendingLegacy?.m };
  const changes: Record<string, T> = {};
  let timer: ReturnType<typeof setTimeout> | undefined;

  const save = async (): Promise<boolean> => {
    const ok = await animeDbWriteProvider({
      key: dbKey,
      value: mem,
      expiresAt: Number.MAX_SAFE_INTEGER,
      fetchedAt: Date.now(),
    });
    if (ok) {
      try {
        localStorage.removeItem(fallbackKey);
      } catch {}
    } else {
      try {
        localStorage.setItem(fallbackKey, JSON.stringify({ t: Date.now(), m: mem }));
      } catch {}
    }
    return ok;
  };

  const ready = (async () => {
    const stored = await animeDbReadProvider<Record<string, T>>(dbKey);
    const fromDb = stored?.value;
    const useFallback = pendingLegacy != null && (!stored || pendingLegacy.t > stored.fetchedAt);
    if (fromDb && typeof fromDb === "object" && !Array.isArray(fromDb)) {
      mem = {
        ...legacy,
        ...fromDb,
        ...(useFallback ? pendingLegacy!.m : {}),
        ...changes,
      };
    } else if (useFallback) {
      mem = { ...legacy, ...pendingLegacy!.m, ...changes };
    }
    // A migrated or recovered record must be durable before old keys are removed.
    if (Object.keys(legacy).length > 0 || pendingLegacy) {
      if (await save()) {
        try {
          localStorage.removeItem(storageKey);
          localStorage.removeItem(fallbackKey);
        } catch {}
      }
    }
  })();

  const flush = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      void ready.then(() => save());
    }, FLUSH_MS);
  };

  return {
    ready,
    get(key) {
      return mem[key];
    },
    set(key, value) {
      mem[key] = value;
      changes[key] = value;
      flush();
    },
  };
}
