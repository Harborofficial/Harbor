import { writeReaderBackground } from "./reader-background-storage";

const DB_NAME = "harbor-reader-backgrounds";
const STORE = "backgrounds";

let database: Promise<IDBDatabase> | null = null;

function indexedDbAvailable() {
  return typeof indexedDB !== "undefined";
}

function openDatabase(): Promise<IDBDatabase> {
  if (!database) {
    database = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Could not open reader storage."));
      request.onblocked = () => reject(new Error("Reader storage is blocked by another window."));
    });
    void database.catch(() => {
      database = null;
    });
  }
  return database;
}

async function getStored(key: string): Promise<string | null> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, "readonly");
    const request = transaction.objectStore(STORE).get(key);
    request.onsuccess = () => resolve(typeof request.result === "string" ? request.result : null);
    request.onerror = () => reject(request.error ?? new Error("Could not read reader storage."));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("Could not read reader storage."));
  });
}

async function putStored(key: string, value: string): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).put(value, key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("Could not save reader storage."));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("Could not save reader storage."));
  });
}

async function deleteStored(key: string): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).delete(key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("Could not clear reader storage."));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("Could not clear reader storage."));
  });
}

function legacyBackground(key: string): string | null {
  try {
    const value = localStorage.getItem(key);
    return value?.startsWith("data:image/") ? value : null;
  } catch {
    return null;
  }
}

export async function loadReaderBackground(key: string): Promise<string | null> {
  if (indexedDbAvailable()) {
    try {
      const stored = await getStored(key);
      if (stored) return stored;
      const legacy = legacyBackground(key);
      if (legacy) {
        try {
          await putStored(key, legacy);
        } catch {
          return legacy;
        }
        try {
          localStorage.removeItem(key);
        } catch {
          // The indexed copy is already durable.
        }
        return legacy;
      }
      return null;
    } catch {
      // Fall back to the legacy store when IndexedDB is unavailable.
    }
  }
  return legacyBackground(key);
}

export async function saveReaderBackground(key: string, value: string): Promise<void> {
  if (indexedDbAvailable()) {
    try {
      await putStored(key, value);
      try {
        localStorage.removeItem(key);
      } catch {
        // The indexed copy is already durable.
      }
      return;
    } catch {
      // Fall back to the legacy store when IndexedDB is unavailable.
    }
  }
  writeReaderBackground(localStorage, value, key);
}

export async function removeReaderBackground(key: string): Promise<void> {
  if (indexedDbAvailable()) {
    try {
      await deleteStored(key);
    } catch (error) {
      try {
        writeReaderBackground(localStorage, null, key);
      } catch {
        // Keep the original indexed-storage error.
      }
      throw error;
    }
    try {
      localStorage.removeItem(key);
    } catch {
      // The indexed copy is already gone.
    }
    return;
  }
  writeReaderBackground(localStorage, null, key);
}
