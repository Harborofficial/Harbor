import { convertFileSrc } from "@tauri-apps/api/core";
import { BaseDirectory, mkdir, remove, writeFile } from "@tauri-apps/plugin-fs";

const INDEX_KEY = "harbor.games.collection-covers.v1";
const DIR = "game-store/covers";
const MAX_EDGE = 900;
const MAX_INPUT_BYTES = 24 * 1024 * 1024;
const QUALITY = 0.9;
const ACCEPTED = /^image\/(png|jpeg|webp|gif|avif)$/;
const EVENT = "harbor:game-collection-cover";
const IS_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

type CoverIndex = Record<string, { file: string; at: number }>;

function readIndex(): CoverIndex {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    const value = raw ? (JSON.parse(raw) as unknown) : null;
    return value && typeof value === "object" && !Array.isArray(value) ? (value as CoverIndex) : {};
  } catch {
    return {};
  }
}

let index = readIndex();
const resolved = new Map<string, string>();

export function gameCollectionCoverEvent(): string {
  return EVENT;
}

function announce(collectionId: string): void {
  if (typeof window !== "undefined")
    window.dispatchEvent(new CustomEvent(EVENT, { detail: collectionId }));
}

async function appDataPath(file: string): Promise<string> {
  const { appDataDir, join } = await import("@tauri-apps/api/path");
  return join(await appDataDir(), file);
}

export function cachedGameCollectionCover(collectionId: string): string | undefined {
  return resolved.get(collectionId);
}

export async function readGameCollectionCover(collectionId: string): Promise<string> {
  const held = resolved.get(collectionId);
  if (held !== undefined) return held;
  const entry = index[collectionId];
  if (!entry || !IS_TAURI) {
    resolved.set(collectionId, "");
    return "";
  }
  try {
    const url = `${convertFileSrc(await appDataPath(entry.file))}?v=${entry.at}`;
    resolved.set(collectionId, url);
    return url;
  } catch {
    resolved.set(collectionId, "");
    return "";
  }
}

async function shrink(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    throw new Error("games.collections.coverFailed");
  }
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, "image/webp", QUALITY));
  if (!blob) throw new Error("games.collections.coverFailed");
  return blob;
}

export async function saveGameCollectionCover(collectionId: string, file: File): Promise<string> {
  if (!ACCEPTED.test(file.type)) throw new Error("games.collections.coverType");
  if (file.size > MAX_INPUT_BYTES) throw new Error("games.collections.coverSize");
  if (!IS_TAURI) throw new Error("games.collections.coverFailed");
  const blob = await shrink(file);
  const safe = collectionId.replace(/[^a-z0-9._-]/gi, "_").slice(0, 60);
  const target = `${DIR}/${safe}.webp`;
  await mkdir(DIR, { baseDir: BaseDirectory.AppData, recursive: true }).catch(() => {});
  await writeFile(target, new Uint8Array(await blob.arrayBuffer()), {
    baseDir: BaseDirectory.AppData,
  });
  const next = { ...index, [collectionId]: { file: target, at: Date.now() } };
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(next));
  } catch {
    await remove(target, { baseDir: BaseDirectory.AppData }).catch(() => {});
    throw new Error("games.collections.coverFailed");
  }
  index = next;
  resolved.delete(collectionId);
  const url = await readGameCollectionCover(collectionId);
  announce(collectionId);
  return url;
}

export async function clearGameCollectionCover(collectionId: string): Promise<void> {
  const entry = index[collectionId];
  if (entry && IS_TAURI) {
    await remove(entry.file, { baseDir: BaseDirectory.AppData }).catch(() => {});
  }
  const next = { ...index };
  delete next[collectionId];
  index = next;
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(next));
  } catch {
    /* the missing file is harmless; the in-memory index is already clear */
  }
  resolved.set(collectionId, "");
  announce(collectionId);
}
