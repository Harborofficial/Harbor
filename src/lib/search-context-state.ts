import { createContext } from "react";
import type { SearchResults } from "@/lib/search";
import type { AddonQuery } from "@/lib/search-addons";

export type SearchState = {
  open: boolean;
  query: string;
  results: SearchResults | null;
  // Keep pending addon slots separate so results remain null until a source answers.
  addonQueries: AddonQuery[];
  status: "idle" | "typing" | "loading" | "done";
  recent: string[];
};

export type SearchActions = {
  setOpen: (open: boolean) => void;
  setQuery: (q: string) => void;
  clear: () => void;
  closeForNavigation: () => void;
  recordRecent: (q: string) => void;
  removeRecent: (q: string) => void;
  clearRecent: () => void;
  setAiHold: (hold: boolean) => void;
  retry: () => void;
};

export type SearchData = Omit<SearchState, "open">;

// Keep context identity independent of hot updates to the provider's search dependencies.
export const DataCtx = createContext<SearchData | null>(null);
export const OpenCtx = createContext<boolean | null>(null);
export const ActionsCtx = createContext<SearchActions | null>(null);
