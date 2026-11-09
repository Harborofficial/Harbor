import { invoke } from "@tauri-apps/api/core";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export async function readSettingsFile(): Promise<string | null> {
  if (!isTauri) return null;
  try {
    return (await invoke<string | null>("settings_read")) ?? null;
  } catch {
    return null;
  }
}

let writes: Promise<void> = Promise.resolve();

export function writeSettingsFile(content: string): Promise<void> {
  if (!isTauri) return Promise.resolve();
  writes = writes.then(async () => {
    try {
      await invoke("settings_write", { content });
    } catch {
      console.error("[settings] Could not save settings to disk");
    }
  });
  return writes;
}
