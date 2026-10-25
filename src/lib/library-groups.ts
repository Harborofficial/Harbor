export type GroupList = { id: string; name: string; url: string };
export type LibraryGroup = {
  id: string;
  name: string;
  image?: string;
  lists: GroupList[];
  pinnedToHome?: boolean;
};

// Accept international slugs while keeping each URL/API path segment safe.
function normalizedListPath(pathname: string): { parts: string[]; path: string } | null {
  const parts = pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (!parts.every((part) => /^[\p{L}\p{M}\p{N}_-]+$/u.test(part))) return null;
  return { parts, path: parts.map(encodeURIComponent).join("/") };
}

export function parseMdblistUrl(value: string): { url: string; path: string } | null {
  try {
    const url = new URL(value.trim());
    if (
      url.protocol !== "https:" ||
      !["mdblist.com", "www.mdblist.com"].includes(url.hostname) ||
      url.username ||
      url.password ||
      url.port
    )
      return null;
    const normalized = normalizedListPath(url.pathname);
    if (!normalized) return null;
    const { parts, path } = normalized;
    if (parts[0] !== "lists" || parts.length < 2 || parts.length > 3) return null;
    if (parts.length === 2 && !/^\d+$/.test(parts[1])) return null;
    return { url: `https://mdblist.com/${path}`, path };
  } catch {
    return null;
  }
}

export function validGroupImage(value: string): boolean {
  if (!value) return true;
  if (/^data:image\/(png|jpeg|webp);base64,[a-zA-Z0-9+/=]+$/.test(value))
    return value.length < 500000;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function parseGroupListUrl(
  value: string,
): { url: string; path: string; source: "mdblist" | "trakt" } | null {
  const mdb = parseMdblistUrl(value);
  if (mdb) return { ...mdb, source: "mdblist" };
  try {
    const url = new URL(value.trim());
    if (
      url.protocol !== "https:" ||
      !["trakt.tv", "www.trakt.tv", "app.trakt.tv"].includes(url.hostname) ||
      url.username ||
      url.password ||
      url.port
    )
      return null;
    const normalized = normalizedListPath(url.pathname);
    if (!normalized) return null;
    const { parts, path } = normalized;
    const personal = parts.length === 4 && parts[0] === "users" && parts[2] === "lists";
    const global = parts.length === 2 && parts[0] === "lists" && /^\d+$/.test(parts[1]);
    if (!personal && !global) return null;
    return { url: `https://trakt.tv/${path}`, path, source: "trakt" };
  } catch {
    return null;
  }
}

export function normalizeLibraryGroups(value: unknown): LibraryGroup[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>();
  return value.flatMap((entry) => {
    if (
      !entry ||
      typeof entry !== "object" ||
      typeof entry.id !== "string" ||
      ids.has(entry.id) ||
      typeof entry.name !== "string" ||
      !entry.name.trim()
    )
      return [];
    ids.add(entry.id);
    const listIds = new Set<string>();
    const lists: GroupList[] = Array.isArray(entry.lists)
      ? entry.lists.flatMap((list: Partial<GroupList> | null) => {
          if (
            !list ||
            typeof list.id !== "string" ||
            listIds.has(list.id) ||
            typeof list.name !== "string" ||
            !list.name.trim() ||
            typeof list.url !== "string"
          )
            return [];
          const parsed = parseGroupListUrl(list.url);
          if (!parsed) return [];
          listIds.add(list.id);
          return [{ id: list.id, name: list.name.trim().slice(0, 100), url: parsed.url }];
        })
      : [];
    return [
      {
        id: entry.id,
        name: entry.name.trim().slice(0, 100),
        image:
          typeof entry.image === "string" && validGroupImage(entry.image) ? entry.image : undefined,
        lists,
        pinnedToHome: entry.pinnedToHome === true,
      },
    ];
  });
}

export function moveGroupItem<T extends { id: string }>(
  items: T[],
  id: string,
  delta: number,
): T[] {
  const index = items.findIndex((item) => item.id === id);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= items.length) return items;
  const result = [...items];
  [result[index], result[target]] = [result[target], result[index]];
  return result;
}
