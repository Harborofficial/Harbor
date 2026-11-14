import cursorPng from "@/assets/harbor-cursor.png";
import cursorArt from "@/assets/harbor-cursor.svg";
import { sanitizeHarborCursorScale } from "./settings/load";
import {
  loadEffective,
  MIRROR_KEY,
  PROFILES_KEY,
  readActiveSource,
} from "./settings/profile-store";

const DEFAULT_SIZE = 32;
const HOTSPOT = { x: 9, y: 1 };
const CURSOR_IMAGE = "--harbor-cursor-image";

function cursorImage(url: string, size: number, density: number): string {
  const x = Math.round((HOTSPOT.x * size) / DEFAULT_SIZE);
  const y = Math.round((HOTSPOT.y * size) / DEFAULT_SIZE);
  const image = `url(${JSON.stringify(url)})`;
  return density === 1 ? `${image} ${x} ${y}` : `image-set(${image} ${density}x) ${x} ${y}`;
}

function renderCursor(art: HTMLImageElement, pixels: number): string {
  const canvas = art.ownerDocument.createElement("canvas");
  canvas.width = canvas.height = pixels;
  try {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not render the Harbor cursor");
    context.drawImage(art, 0, 0, pixels, pixels);
    return canvas.toDataURL();
  } finally {
    canvas.width = canvas.height = 0;
  }
}

type CursorRequest = { size: number; image?: HTMLImageElement };

export function mountHarborCursor(target: Window) {
  const { document } = target;
  const root = document.documentElement;
  // Tag the larger bitmap so display density affects sharpness without changing logical size.
  const css = (target as Window & typeof globalThis).CSS;
  const density = css?.supports("cursor", 'image-set(url("cursor.png") 2x), default') ? 2 : 1;
  let disposed = false;
  let art: { image: HTMLImageElement; decoded: Promise<void> } | undefined;
  let pending: CursorRequest | undefined;
  let applied: CursorRequest | undefined;

  async function loadArt() {
    if (!art) {
      const image = document.createElement("img");
      image.src = cursorArt;
      art = { image, decoded: image.decode() };
    }
    const source = art;
    try {
      await source.decoded;
      return source.image;
    } catch (error) {
      if (art === source) {
        source.image.removeAttribute("src");
        art = undefined;
      }
      throw error;
    }
  }

  async function prepare(request: CursorRequest) {
    try {
      let url = cursorPng;
      if (request.size !== DEFAULT_SIZE || density !== 1) {
        const source = await loadArt();
        if (pending !== request) return;
        url = renderCursor(source, request.size * density);
      }
      const image = document.createElement("img");
      request.image = image;
      image.src = url;
      await image.decode();
      if (pending !== request) return;
      root.style.setProperty(CURSOR_IMAGE, cursorImage(url, request.size, density));
      root.setAttribute("data-harbor-cursor", "");
      applied?.image?.removeAttribute("src");
      applied = request;
    } catch (error) {
      if (pending === request) console.warn("[harbor-cursor] could not prepare the image", error);
    } finally {
      if (pending === request) pending = undefined;
      if (applied !== request) request.image?.removeAttribute("src");
    }
  }

  return {
    setScale(scale: number) {
      const size = Math.round(DEFAULT_SIZE * sanitizeHarborCursorScale(scale));
      if (disposed || pending?.size === size) return;
      pending?.image?.removeAttribute("src");
      pending = undefined;
      if (applied?.size === size) return;
      const request = { size };
      pending = request;
      void prepare(request);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      root.removeAttribute("data-harbor-cursor");
      root.style.removeProperty(CURSOR_IMAGE);
      pending?.image?.removeAttribute("src");
      applied?.image?.removeAttribute("src");
      art?.image.removeAttribute("src");
      pending = undefined;
      applied = undefined;
      art = undefined;
    },
  };
}

/** Keep observing preferences in companions so the main window can enable them again. */
export function observeStoredHarborCursor(target: Window): () => void {
  const storage = target.localStorage;
  let cursor: ReturnType<typeof mountHarborCursor> | undefined;
  const sync = () => {
    const { profileId, linked } = readActiveSource();
    const { harborCursor, harborCursorScale } = loadEffective(profileId, linked);
    if (harborCursor) {
      cursor ??= mountHarborCursor(target);
      cursor.setScale(harborCursorScale);
    } else {
      cursor?.dispose();
      cursor = undefined;
    }
  };
  const onStorage = (event: StorageEvent) => {
    const { key } = event;
    if (
      event.storageArea === storage &&
      (key === null ||
        key === PROFILES_KEY ||
        key === MIRROR_KEY ||
        key.startsWith(`${MIRROR_KEY}.`))
    ) {
      sync();
    }
  };

  target.addEventListener("storage", onStorage);
  sync();
  return () => {
    target.removeEventListener("storage", onStorage);
    cursor?.dispose();
  };
}
