import { activeProfileId } from "./active-profile-id";
import type { Addon } from "./addons";

export type CatalogSource = "combined" | "stremio" | "local";
const PREFIX = "harbor.catalogs.local.";
const listeners = new Set<() => void>();

function key(part: string, profile: string): string {
  return `${PREFIX}${profile}.${part}`;
}

function read(part: string, profile: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key(part, profile)) ?? "null");
  } catch {
    return null;
  }
}

function write(part: string, value: unknown, profile: string): void {
  const encoded = JSON.stringify(value);
  if (localStorage.getItem(key(part, profile)) === encoded) return;
  localStorage.setItem(key(part, profile), encoded);
  if (profile === activeProfileId()) {
    for (const fn of listeners) fn();
    if (typeof window !== "undefined") window.dispatchEvent(new Event("harbor:addons-changed"));
  }
}

export function subscribeLocalCatalogs(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function catalogSource(profile = activeProfileId()): CatalogSource {
  const value = read("source", profile);
  return value === "stremio" || value === "local" ? value : "combined";
}

export function setCatalogSource(value: CatalogSource): void {
  write("source", value, activeProfileId());
}

function validAddon(value: unknown): value is Addon {
  if (!value || typeof value !== "object") return false;
  const addon = value as Partial<Addon>;
  return (
    typeof addon.transportUrl === "string" &&
    !!addon.transportUrl &&
    !!addon.manifest &&
    typeof addon.manifest.id === "string" &&
    typeof addon.manifest.name === "string"
  );
}

export function rememberedCatalogAddons(profile = activeProfileId()): Addon[] {
  const value = read("addons", profile);
  return Array.isArray(value) ? value.filter(validAddon) : [];
}

export function rememberCatalogAddons(addons: Addon[], profile = activeProfileId()): void {
  write(
    "addons",
    addons.filter(validAddon).map(({ transportUrl, manifest }) => ({
      transportUrl,
      manifest,
    })),
    profile,
  );
}

export async function catalogAccountAddons(
  authKey: string | null,
  fetchAccount: (key: string) => Promise<Addon[] | null>,
): Promise<Addon[]> {
  const profile = activeProfileId();
  const source = catalogSource(profile);
  if (source === "local") return rememberedCatalogAddons(profile);
  if (!authKey) return [];
  const fresh = await fetchAccount(authKey).catch(() => null);
  if (fresh == null) return rememberedCatalogAddons(profile);
  try {
    rememberCatalogAddons(fresh, profile);
  } catch {
    // A full disk must not hide an otherwise working account collection.
  }
  return fresh;
}

export function orderLocalCatalogs<T extends { key: string }>(items: T[]): T[] {
  if (catalogSource() !== "local") return items;
  const saved = read("order", activeProfileId());
  if (!Array.isArray(saved)) return items;
  const rank = new Map(
    saved.filter((id): id is string => typeof id === "string").map((id, index) => [id, index]),
  );
  return [...items].sort((a, b) => (rank.get(a.key) ?? Infinity) - (rank.get(b.key) ?? Infinity));
}

export function saveLocalCatalogOrder(keys: string[]): void {
  write("order", [...new Set(keys)], activeProfileId());
}

export function purgeLocalCatalogs(profile: string): void {
  for (const part of ["source", "addons", "order"]) localStorage.removeItem(key(part, profile));
}
