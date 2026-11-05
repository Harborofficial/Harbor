import { safeFetchBytes } from "@/lib/safe-fetch";
import { GameRequestPool } from "./request-pool";
import { parseHowLongToBeatSearch, type HowLongToBeatTimes } from "./howlongtobeat-data";

// HLTB does not publish a supported API. Keep its volatile protocol isolated.
const BASE = "https://howlongtobeat.com";
const pool = new GameRequestPool(1);
const cache = new Map<string, { at: number; value: HowLongToBeatTimes | null }>();
const SUCCESS_TTL = 24 * 60 * 60_000, MISS_TTL = 6 * 60 * 60_000;
let unavailableUntil = 0;
let credentials: { token: string; hpKey?: string; hpVal?: string; at: number } | null = null;
const headers = { "User-Agent": "Mozilla/5.0", "Accept": "application/json", "Referer": `${BASE}/` };

async function getCredentials(signal: AbortSignal) {
  if (credentials && Date.now() - credentials.at < 10 * 60_000) return credentials;
  const response = await safeFetchBytes(`${BASE}/api/search/site/init?t=${Date.now()}`, { headers, signal: AbortSignal.any([signal, AbortSignal.timeout(8_000)]) }, 8_000, 16 * 1024);
  if (!response.ok) throw Error(`HowLongToBeat auth ${response.status}`);
  const raw: unknown = await response.json();
  if (!raw || typeof raw !== "object" || !("token" in raw) || typeof raw.token !== "string" || !raw.token) throw Error("Invalid HowLongToBeat token");
  const hpKey = "hpKey" in raw && typeof raw.hpKey === "string" && /^[a-zA-Z0-9_]{1,100}$/.test(raw.hpKey) ? raw.hpKey : undefined;
  const hpVal = "hpVal" in raw && typeof raw.hpVal === "string" ? raw.hpVal : undefined;
  credentials = { token: raw.token, hpKey, hpVal, at: Date.now() };
  return credentials;
}

async function search(title: string, signal: AbortSignal) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const auth = await getCredentials(signal);
    const body: Record<string, unknown> = {
      searchType: "games", searchTerms: title.trim().split(/\s+/), searchPage: 1, size: 20,
      searchOptions: {
        games: { userId: 0, platform: "", sortCategory: "popular", rangeCategory: "main", rangeTime: { min: null, max: null }, gameplay: { perspective: "", flow: "", genre: "", difficulty: "" }, rangeYear: { min: "", max: "" }, modifier: "" },
        users: { sortCategory: "postcount" }, lists: { sortCategory: "follows" }, filter: "", sort: 0, randomizer: 0,
      }, useCache: true,
    };
    if (auth.hpKey && auth.hpVal) body[auth.hpKey] = auth.hpVal;
    const response = await safeFetchBytes(`${BASE}/api/search/site`, {
      method: "POST", headers: { ...headers, "Content-Type": "application/json", "Origin": BASE, "x-auth-token": auth.token, ...(auth.hpKey && auth.hpVal ? { "x-hp-key": auth.hpKey, "x-hp-val": auth.hpVal } : {}) },
      body: JSON.stringify(body), signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
    }, 10_000, 512 * 1024);
    if ([401, 403].includes(response.status) && attempt === 0) { credentials = null; continue; }
    if (!response.ok) throw Error(`HowLongToBeat search ${response.status}`);
    return response.json() as Promise<unknown>;
  }
  throw Error("HowLongToBeat authorization unavailable");
}

export async function loadHowLongToBeat(title: string, releaseYear: number | undefined, signal: AbortSignal): Promise<HowLongToBeatTimes | null> {
  const query = title.trim();
  if (query.length < 2 || query.length > 160 || Date.now() < unavailableUntil) return null;
  const key = `${query.toLocaleLowerCase("en")}:${releaseYear ?? ""}`;
  const held = cache.get(key);
  if (held && Date.now() - held.at < (held.value ? SUCCESS_TTL : MISS_TTL)) return held.value;
  return pool.run(async () => {
    signal.throwIfAborted();
    if (Date.now() < unavailableUntil) return null;
    try {
      const value = parseHowLongToBeatSearch(await search(query, signal), query, releaseYear);
      signal.throwIfAborted();
      cache.delete(key); cache.set(key, { at: Date.now(), value });
      if (cache.size > 80) cache.delete(cache.keys().next().value!);
      return value;
    } catch (error) {
      if (signal.aborted) throw error;
      unavailableUntil = Date.now() + 5 * 60_000;
      return null;
    }
  }, signal);
}
