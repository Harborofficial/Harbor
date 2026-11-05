const STORAGE_KEY = "harbor.player.prefs.v1";
const MAX_ENTRIES = 200;

export type PerShowPrefs = {
  rate?: number;
  subDelaySec?: number;
  subDelayTrackKind?: "embedded" | "external";
  audioLang?: string;
  subLang?: string;
  subsOff?: boolean;
  updatedAt: number;
};

type Store = Record<string, PerShowPrefs>;

let cache: Store | null = null;

// During playback, an Auto sync shift is composed on top of the viewer's
// manual baseline. Do not accidentally persist that composite as the baseline,
// or reopening the episode would add the saved Auto sync shift twice.
let subDelayMapper: ((metaId: string, sec: number) => number) | null = null;
let subDelayTrackKindResolver: ((metaId: string) => "embedded" | "external" | null) | null = null;
export function registerPlayerSubDelayTrackKindResolver(
  resolver: (metaId: string) => "embedded" | "external" | null,
): () => void {
  const previous = subDelayTrackKindResolver;
  subDelayTrackKindResolver = resolver;
  return () => {
    if (subDelayTrackKindResolver === resolver) subDelayTrackKindResolver = previous;
  };
}
export function registerPlayerSubDelayMapper(mapper: (metaId: string, sec: number) => number): () => void {
  const previous = subDelayMapper;
  subDelayMapper = mapper;
  return () => {
    if (subDelayMapper === mapper) subDelayMapper = previous;
  };
}

function loadStore(): Store {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    cache = raw ? (JSON.parse(raw) as Store) : {};
  } catch {
    cache = {};
  }
  return cache;
}

function persistStore(): void {
  if (!cache) return;
  const entries = Object.entries(cache);
  if (entries.length > MAX_ENTRIES) {
    entries.sort((a, b) => b[1].updatedAt - a[1].updatedAt);
    cache = Object.fromEntries(entries.slice(0, MAX_ENTRIES));
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {
    /* ignore */
  }
}

export function readPlayerPrefs(metaId: string): PerShowPrefs | null {
  if (!metaId) return null;
  const store = loadStore();
  return store[metaId] ?? null;
}

export function writePlayerPrefs(metaId: string, patch: Partial<PerShowPrefs>): void {
  if (!metaId) return;
  const store = loadStore();
  const prev = store[metaId] ?? { updatedAt: 0 };
  const mapped = typeof patch.subDelaySec === "number" && subDelayMapper
    ? { ...patch, subDelaySec: subDelayMapper(metaId, patch.subDelaySec) }
    : patch;
  const trackKind = typeof patch.subDelaySec === "number"
    ? subDelayTrackKindResolver?.(metaId) : null;
  store[metaId] = {
    ...prev, ...mapped,
    ...(trackKind ? { subDelayTrackKind: trackKind } : {}),
    updatedAt: Date.now(),
  };
  persistStore();
}

export function clearPlayerPrefs(metaId: string): void {
  if (!metaId) return;
  const store = loadStore();
  delete store[metaId];
  persistStore();
}
