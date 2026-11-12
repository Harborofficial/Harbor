import { loadFontData } from "@/lib/font-storage";

const DISK_EXT: Record<string, string> = { truetype: "ttf", opentype: "otf" };

export type InstallableFont = {
  id: string;
  name: string;
  format: string;
  family?: string;
  dataUrl?: string;
};

/** libass reads sfnt files; WOFF/WOFF2 can only be used by the HTML overlay. */
export function libassFontExt(format: string): string | null {
  return DISK_EXT[format] ?? null;
}

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function base64Of(dataUrl: string): string | null {
  const comma = dataUrl.indexOf(",");
  if (comma < 0 || !dataUrl.slice(0, comma).includes(";base64")) return null;
  return dataUrl.slice(comma + 1);
}

async function invokeCommand<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}

export async function listInstalledSubFonts(): Promise<string[] | null> {
  if (!isTauri()) return null;
  try {
    return await invokeCommand<string[]>("list_sub_fonts");
  } catch (e) {
    console.warn("[fonts] list_sub_fonts failed", e);
    return null;
  }
}

async function removeSubFont(id: string): Promise<boolean> {
  try {
    await invokeCommand("remove_sub_font", { id });
    return true;
  } catch (e) {
    console.warn("[fonts] remove_sub_font failed", id, e);
    return false;
  }
}

/** Deletes a font only when its owner removes it, never during a profile change. */
export function removeCustomFont(id: string): Promise<boolean> {
  return removeSubFont(id);
}

/** Writes a font file directly where libass reads it. WOFF/WOFF2 are not sfnt. */
export async function installCustomFont(font: InstallableFont, dataUrl: string): Promise<boolean> {
  if (!isTauri()) return false;
  const ext = libassFontExt(font.format);
  const base64 = base64Of(dataUrl);
  if (!ext || !base64) return false;
  try {
    await invokeCommand("install_sub_font", { id: font.id, ext, base64 });
    return true;
  } catch (e) {
    console.warn("[fonts] install_sub_font failed", font.id, e);
    return false;
  }
}

let syncQueue: Promise<Set<string>> = Promise.resolve(new Set());

async function syncNow(fonts: InstallableFont[]): Promise<Set<string>> {
  if (!isTauri()) return new Set();
  const usable = fonts.filter((font) => libassFontExt(font.format) != null);
  const onDisk = await listInstalledSubFonts();
  const installed = new Set(onDisk ?? []);

  // Fonts are shared across profiles while customFonts is per profile, so a
  // profile change must not delete another profile's files. Only the explicit
  // remove action does that. A failed listing still falls through to installs:
  // writeFile is idempotent, and an existing file is already all libass needs.
  const missing: string[] = [];
  for (const font of usable) {
    if (installed.has(font.id)) continue;
    const dataUrl = font.dataUrl ?? (await loadFontData(font.id));
    if (!dataUrl) {
      missing.push(font.id);
      continue;
    }
    if (await installCustomFont(font, dataUrl)) installed.add(font.id);
    else missing.push(font.id);
  }
  if (missing.length > 0) {
    console.warn(
      "[fonts] these fonts are missing their browser data and cannot be used by styled subtitles:",
      missing,
    );
  }
  return installed;
}

/**
 * Keeps the shared fonts directory in step with the saved custom fonts. Calls are
 * serialized so overlapping runs cannot install the same file twice or race with an
 * explicit removal, and a font that is already on disk stays usable even if its
 * browser blob is gone.
 */
export function syncSubFontsToDisk(fonts: InstallableFont[]): Promise<Set<string>> {
  const run = () => syncNow(fonts);
  const next = syncQueue.then(run, run);
  syncQueue = next.catch(() => new Set<string>());
  return next;
}
