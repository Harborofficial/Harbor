import { safeFetchBytes } from "@/lib/safe-fetch";
import { GameRequestPool } from "./request-pool";
import type { GameLink } from "./library-links";
import { parseNexusGameLink } from "./nexus-game-data";

// Nexus v2 GraphQL game discovery is public, but not a formally stable API.
const QUERY = `query FindGame($term: String!) { games(count: 20, offset: 0, filter: { name: [{ value: $term, op: WILDCARD }] }) { totalCount nodes { id name domainName } } }`;
const pool = new GameRequestPool(2);
const cache = new Map<string, { value: GameLink | null; at: number }>();
let unavailableUntil = 0;

export async function loadNexusGameLink(title: string, signal: AbortSignal): Promise<GameLink | null> {
  const name = title.trim();
  if (name.length < 2 || name.length > 160) return null;
  const key = name.toLocaleLowerCase("en");
  const previous = cache.get(key);
  if (previous && Date.now() - previous.at < (previous.value ? 24 * 60 * 60_000 : 6 * 60 * 60_000)) return previous.value;
  if (Date.now() < unavailableUntil) return null;
  return pool.run(async () => {
    if (Date.now() < unavailableUntil) return null;
    try {
      const response = await safeFetchBytes("https://api.nexusmods.com/v2/graphql", {
        method: "POST", headers: { "content-type": "application/json", "accept": "application/json" },
        body: JSON.stringify({ query: QUERY, variables: { term: name } }),
        signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
      }, 10_000, 128 * 1024);
      if (!response.ok) throw Error(`Nexus games ${response.status}`);
      const value = parseNexusGameLink(await response.json(), name);
      signal.throwIfAborted();
      cache.delete(key); cache.set(key, { value, at: Date.now() });
      if (cache.size > 120) cache.delete(cache.keys().next().value!);
      return value;
    } catch (error) {
      if (signal.aborted) throw error;
      unavailableUntil = Date.now() + 5 * 60_000;
      return null;
    }
  }, signal);
}
