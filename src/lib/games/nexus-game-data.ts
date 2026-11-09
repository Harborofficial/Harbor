import type { GameLink } from "./library-links";

type Row = Record<string, unknown>;
const object = (value: unknown): value is Row => !!value && typeof value === "object" && !Array.isArray(value);
const normalize = (name: string) => name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("en").replace(/[’']/g, "").replace(/&/g, " and ").replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");

/** Resolve actual Nexus game domains, never guessed name-based slugs. */
export function parseNexusGameLink(value: unknown, title: string): GameLink | null {
  if (!object(value) || !object(value.data) || !object(value.data.games) || !Array.isArray(value.data.games.nodes)) return null;
  const requested = normalize(title);
  if (!requested) return null;
  const matches = value.data.games.nodes.flatMap((entry: unknown) => {
    if (!object(entry) || typeof entry.name !== "string" || normalize(entry.name) !== requested || typeof entry.domainName !== "string") return [];
    const domain = entry.domainName;
    if (!/^[a-z0-9][a-z0-9_-]{0,100}$/.test(domain)) return [];
    return [domain];
  });
  const distinct = [...new Set(matches)];
  return distinct.length === 1 ? { name: "Nexus Mods", url: `https://www.nexusmods.com/games/${distinct[0]}/mods` } : null;
}
