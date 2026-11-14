import type { Tab } from "./shared";

// A Record rather than a list, so adding a Tab without deciding here fails to compile.
const HIDEABLE: Record<Exclude<Tab, "library">, true> = {
  watchlist: true,
  history: true,
  local: true,
  "media-servers": true,
  torbox: true,
  lists: true,
  groups: true,
  favorites: true,
  trakt: true,
  anilist: true,
  mal: true,
  simkl: true,
  publicmetadb: true,
  letterboxd: true,
};

/** Every tab except the Library tab itself, which stays as the landing tab. */
export const HIDEABLE_LIBRARY_TABS = Object.keys(HIDEABLE) as Exclude<Tab, "library">[];

const HIDEABLE_SET = new Set<string>(HIDEABLE_LIBRARY_TABS);

/** Stored settings may hold stale or malformed ids; keep only tabs that can be hidden. */
export function hiddenLibraryTabs(stored: unknown): Set<Tab> {
  const hidden = new Set<Tab>();
  if (!Array.isArray(stored)) return hidden;
  for (const id of stored) {
    if (typeof id === "string" && HIDEABLE_SET.has(id)) hidden.add(id as Tab);
  }
  return hidden;
}

/**
 * The open tab keeps its button even when hidden, so a tab reached through
 * navigation (a saved tab, or a group opened from elsewhere) is never orphaned.
 */
export function isLibraryTabShown(tab: Tab, hidden: ReadonlySet<Tab>, activeTab: Tab): boolean {
  return tab === activeTab || !hidden.has(tab);
}

/**
 * Whether any tab the user can currently see in the menu is hidden. A hidden tab
 * for a service that has since been disconnected does not count, because the
 * menu has nothing to uncheck for it.
 */
export function hasHiddenAvailableTab(
  available: readonly Tab[],
  hidden: ReadonlySet<Tab>,
): boolean {
  return available.some((tab) => tab !== "library" && hidden.has(tab));
}

export function toggleHiddenLibraryTab(hidden: ReadonlySet<Tab>, tab: Tab): Tab[] {
  if (!HIDEABLE_SET.has(tab)) return HIDEABLE_LIBRARY_TABS.filter((id) => hidden.has(id));
  const next = new Set(hidden);
  if (next.has(tab)) next.delete(tab);
  else next.add(tab);
  return HIDEABLE_LIBRARY_TABS.filter((id) => next.has(id));
}
