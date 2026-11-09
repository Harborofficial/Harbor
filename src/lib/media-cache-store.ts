export type MediaCacheRecord<T = unknown> = {
  key: string;
  value: T;
  storedAt: number;
  freshUntil: number;
  staleUntil: number;
  accessedAt: number;
  bytes: number;
};

export type MediaCacheIndex = Omit<MediaCacheRecord, "value">;

export interface MediaCacheStore {
  get(key: string): Promise<MediaCacheRecord | null>;
  put(record: MediaCacheRecord): Promise<boolean>;
  remove(keys: string[]): Promise<void>;
  list(): Promise<MediaCacheIndex[]>;
  clear(): Promise<boolean>;
  touch?(key: string, accessedAt: number): Promise<void>;
  removeExpired?(now: number): Promise<string[]>;
}

const DATABASE = "harbor-media-cache";
let opening: Promise<IDBDatabase | null> | undefined;
let retryAt = 0;

function open(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined" || Date.now() < retryAt) return Promise.resolve(null);
  if (opening) return opening;
  opening = new Promise<IDBDatabase | null>((resolve) => {
    let settled = false;
    const fail = () => {
      if (settled) return;
      settled = true;
      retryAt = Date.now() + 60_000;
      opening = undefined;
      resolve(null);
    };
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DATABASE, 2);
    } catch {
      fail();
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("entries"))
        db.createObjectStore("entries", { keyPath: "key" });
      const index = db.objectStoreNames.contains("index")
        ? request.transaction!.objectStore("index")
        : db.createObjectStore("index", { keyPath: "key" });
      if (!index.indexNames.contains("expired")) index.createIndex("expired", "staleUntil");
      if (!index.indexNames.contains("accessed")) index.createIndex("accessed", "accessedAt");
    };
    request.onerror = fail;
    request.onblocked = fail;
    request.onsuccess = () => {
      const db = request.result;
      if (settled) {
        db.close();
        return;
      }
      settled = true;
      db.onversionchange = () => {
        db.close();
        opening = undefined;
      };
      resolve(db);
    };
  }).then((db) => {
    if (!db) opening = undefined;
    return db;
  });
  return opening;
}

async function transaction<T>(
  mode: IDBTransactionMode,
  work: (tx: IDBTransaction, result: (value: T) => void) => void,
): Promise<{ ok: boolean; value?: T }> {
  const db = await open();
  if (!db) return { ok: false };
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(["entries", "index"], mode);
      let value: T | undefined;
      tx.oncomplete = () => resolve({ ok: true, value });
      tx.onabort = () => resolve({ ok: false });
      tx.onerror = () => {};
      try {
        work(tx, (next) => {
          value = next;
        });
      } catch {
        tx.abort();
      }
    } catch {
      resolve({ ok: false });
    }
  });
}

async function removeKeys(keys: string[]): Promise<void> {
  if (!keys.length) return;
  await transaction("readwrite", (tx) => {
    for (const key of keys) {
      tx.objectStore("entries").delete(key);
      tx.objectStore("index").delete(key);
    }
  });
}

export const mediaCacheStore: MediaCacheStore = {
  async touch(key, accessedAt) {
    await transaction("readwrite", (tx) => {
      const index = tx.objectStore("index");
      const request = index.get(key);
      request.onsuccess = () => {
        if (request.result) index.put({ ...request.result, accessedAt });
      };
    });
  },
  async get(key) {
    const result = await transaction<MediaCacheRecord>("readonly", (tx, set) => {
      const request = tx.objectStore("entries").get(key);
      request.onsuccess = () => set(request.result);
    });
    return result.ok ? (result.value ?? null) : null;
  },
  async put(record) {
    const result = await transaction("readwrite", (tx) => {
      const { value: _value, ...index } = record;
      tx.objectStore("entries").put(record);
      tx.objectStore("index").put(index);
    });
    return result.ok;
  },
  async remove(keys) {
    await removeKeys(keys);
  },
  async removeExpired(now) {
    const expired = await transaction<IDBValidKey[]>("readonly", (tx, set) => {
      const request = tx
        .objectStore("index")
        .index("expired")
        .getAllKeys(IDBKeyRange.upperBound(now));
      request.onsuccess = () => set(request.result);
    });
    const keys = expired.ok ? (expired.value ?? []).map(String) : [];
    await removeKeys(keys);
    return keys;
  },
  async list() {
    const result = await transaction<MediaCacheIndex[]>("readonly", (tx, set) => {
      const request = tx.objectStore("index").getAll();
      request.onsuccess = () => set(request.result);
    });
    return result.ok ? (result.value ?? []) : [];
  },
  async clear() {
    const result = await transaction("readwrite", (tx) => {
      tx.objectStore("entries").clear();
      tx.objectStore("index").clear();
    });
    return result.ok;
  },
};
