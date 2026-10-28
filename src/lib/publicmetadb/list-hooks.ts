import { useSyncExternalStore } from "react";
import { getPmdbListsVersion, subscribePmdbLists } from "./lists";

export function usePmdbListsVersion(): number {
  return useSyncExternalStore(subscribePmdbLists, getPmdbListsVersion);
}
