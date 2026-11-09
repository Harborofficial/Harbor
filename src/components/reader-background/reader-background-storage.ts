export const READER_BACKGROUND_KEY = "harbor.ebook.reader.background.v1";

type BackgroundStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function writeReaderBackground(
  storage: BackgroundStorage,
  value: string | null,
  key = READER_BACKGROUND_KEY,
): void {
  if (!value) {
    storage.removeItem(key);
    return;
  }
  const previous = storage.getItem(key);
  // Some engines charge the old value against the quota while replacing it.
  storage.removeItem(key);
  try {
    storage.setItem(key, value);
  } catch (error) {
    if (previous !== null) {
      try {
        storage.setItem(key, previous);
      } catch {
        // Keep the original quota error.
      }
    }
    throw error;
  }
}
