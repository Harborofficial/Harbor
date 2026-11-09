import { writeReaderBackground } from "./reader-background-storage";

const DB_NAME = "harbor-reader-backgrounds";
const STORE = "backgrounds";
const AUTHORITY_SUFFIX = ".authority";

type BackgroundAuthority = "local" | "deleted";

export function readerBackgroundAuthorityKey(key: string): string {
  return key + AUTHORITY_SUFFIX;
}

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

function readAuthority(key: string): BackgroundAuthority | null {
  try {
    const value = localStorage.getItem(readerBackgroundAuthorityKey(key));
    return value === "local" || value === "deleted" ? value : null;
  } catch {
    return null;
  }
}

function writeAuthority(key: string, value: BackgroundAuthority | null): void {
  try {
    const marker = readerBackgroundAuthorityKey(key);
    if (value) localStorage.setItem(marker, value);
    else localStorage.removeItem(marker);
  } catch {
    // A marker write is tiny; if it still fails, the image write already failed too.
  }
}

function removeLegacy(key: string): boolean {
  try {
    localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
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
  const authority = readAuthority(key);

  if (authority === "deleted") {
    // A reset owns this key even if the IndexedDB delete failed. Retry the delete
    // and keep the tombstone until both copies are actually gone.
    const localGone = removeLegacy(key);
    if (indexedDbAvailable()) {
      try {
        await deleteStored(key);
      } catch {
        return null;
      }
    }
    if (localGone) writeAuthority(key, null);
    return null;
  }

  if (authority === "local") {
    const local = legacyBackground(key);
    if (local) {
      if (indexedDbAvailable()) {
        try {
          await putStored(key, local);
          // Only after the IndexedDB write lands does the fallback stop being authoritative.
          writeAuthority(key, null);
          removeLegacy(key);
        } catch {
          // Keep the newer local copy; the next load can try the migration again.
        }
      }
      return local;
    }
    // A stale marker without an image: let the IndexedDB copy answer.
    writeAuthority(key, null);
  }

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
        removeLegacy(key);
        writeAuthority(key, null);
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
      // IndexedDB owns the copy now; retire the fallback and its marker only afterwards.
      writeAuthority(key, null);
      removeLegacy(key);
      return;
    } catch {
      // Keep the newer value in the fallback store when the replacement failed.
    }
  }
  writeReaderBackground(localStorage, value, key);
  writeAuthority(key, "local");
}

export async function removeReaderBackground(key: string): Promise<void> {
  // Tombstone before touching either copy so a failed delete cannot resurrect it.
  writeAuthority(key, "deleted");
  const localGone = removeLegacy(key);

  if (indexedDbAvailable()) {
    // If this rejects, the tombstone stays: loadReaderBackground keeps returning
    // null and retries the IndexedDB delete on the next open.
    await deleteStored(key);
  }

  if (localGone) writeAuthority(key, null);
}
