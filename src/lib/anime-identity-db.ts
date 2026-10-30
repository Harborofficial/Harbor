/**
 * IndexedDB-backed anime identity and provider cache.
 * Stores are separated so large AniZip/episode records never inflate a small
 * synchronous identity lookup or the browser's localStorage quota.
 */
const DB_NAME = "harbor-anime-cache";
const DB_VERSION = 1;
const ENTRIES = "anime_entries";
const IDS = "id_mappings";
const EPISODES = "episode_mappings";
const PROVIDERS = "provider_cache";

export type AnimeIdentityRecord = {
  key: string;
  value: string;
  updatedAt: number;
};
export type AnimeProviderRecord<T = unknown> = {
  key: string;
  value: T;
  expiresAt: number;
  fetchedAt: number;
};
export type AnimeEntryRecord = {
  key: string;
  ids: Record<string, string | number>;
  updatedAt: number;
};
export type AnimeEpisodeRecord = {
  key: string;
  season: number | null;
  episode: number;
  absolute: number | null;
  tvdbId: number | null;
};

let connection: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  if (connection) return connection;
  connection = new Promise((resolve) => {
    let settled = false;
    const finish = (db: IDBDatabase | null) => {
      if (settled) {
        db?.close();
        return;
      }
      settled = true;
      if (!db) connection = null; // A blocked/unavailable DB can be retried.
      resolve(db);
    };
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const store of [ENTRIES, IDS, EPISODES, PROVIDERS]) {
          if (!db.objectStoreNames.contains(store)) db.createObjectStore(store, { keyPath: "key" });
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => {
          db.close();
          connection = null;
        };
        db.onclose = () => {
          connection = null;
        };
        finish(db);
      };
      req.onerror = () => finish(null);
      req.onblocked = () => finish(null);
    } catch {
      finish(null);
    }
  });
  return connection;
}

async function read<T>(storeName: string, key?: string): Promise<T | null> {
  const db = await open();
  if (!db) return null;
  return new Promise<T | null>((resolve) => {
    try {
      const tx = db.transaction(storeName, "readonly");
      const req =
        key === undefined ? tx.objectStore(storeName).getAll() : tx.objectStore(storeName).get(key);
      req.onsuccess = () => resolve((req.result as T | undefined) ?? null);
      req.onerror = () => resolve(null);
      tx.onabort = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/** Resolves true only after the entire transaction commits. */
async function putAll<T>(storeName: string, rows: T[]): Promise<boolean> {
  if (rows.length === 0) return true;
  const db = await open();
  if (!db) return false;
  return new Promise<boolean>((resolve) => {
    try {
      const tx = db.transaction(storeName, "readwrite");
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
      const store = tx.objectStore(storeName);
      for (const row of rows) store.put(row);
    } catch {
      resolve(false);
    }
  });
}

export function animeDbReadIdentities(): Promise<AnimeIdentityRecord[] | null> {
  return read<AnimeIdentityRecord[]>(IDS);
}

export function animeDbWriteIdentities(rows: AnimeIdentityRecord[]): Promise<boolean> {
  return putAll(IDS, rows);
}

export function animeDbReadProvider<T>(key: string): Promise<AnimeProviderRecord<T> | null> {
  return read<AnimeProviderRecord<T>>(PROVIDERS, key);
}

export function animeDbWriteProvider<T>(record: AnimeProviderRecord<T>): Promise<boolean> {
  return putAll(PROVIDERS, [record]);
}

export function animeDbWriteEntries(rows: AnimeEntryRecord[]): Promise<boolean> {
  return putAll(ENTRIES, rows);
}

export function animeDbReadEntries(): Promise<AnimeEntryRecord[] | null> {
  return read<AnimeEntryRecord[]>(ENTRIES);
}

export function animeDbReadEntry(key: string): Promise<AnimeEntryRecord | null> {
  return read<AnimeEntryRecord>(ENTRIES, key);
}

export function animeDbWriteEpisodes(rows: AnimeEpisodeRecord[]): Promise<boolean> {
  return putAll(EPISODES, rows);
}

export function animeDbReadEpisodes(): Promise<AnimeEpisodeRecord[] | null> {
  return read<AnimeEpisodeRecord[]>(EPISODES);
}

export function animeDbReadEpisode(key: string): Promise<AnimeEpisodeRecord | null> {
  return read<AnimeEpisodeRecord>(EPISODES, key);
}
