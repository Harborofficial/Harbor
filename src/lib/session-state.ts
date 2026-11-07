import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

// UI state that should survive the layer's idle eviction within one app
// session, but must not persist across restarts. Not settings-backed.
const memory = new Map<string, unknown>();

export function readSessionState<T>(key: string): T | undefined {
  return memory.get(key) as T | undefined;
}

export function writeSessionState<T>(key: string, value: T): void {
  memory.set(key, value);
}

export function useSessionState<T>(
  key: string,
  initial: T | (() => T),
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    if (memory.has(key)) return memory.get(key) as T;
    return typeof initial === "function" ? (initial as () => T)() : initial;
  });
  useEffect(() => {
    memory.set(key, value);
  }, [key, value]);
  return [value, setValue];
}
