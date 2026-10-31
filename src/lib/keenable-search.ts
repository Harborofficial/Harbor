// Keenable search API as an opt-in alternative to the DuckDuckGo + Jina Reader path.
// One request returns ranked results with page text, so no second fetch per hit is needed.
// Works without a key; a key only lifts the anonymous rate limit.

import { hitsToContext, type WebHit } from "./jina-search";

const ENDPOINT = "https://api.keenable.ai/v1/search";
const MAX_RESULTS = 8;
const MAX_SNIPPET_CHARS = 800;
// The webview's CORS preflight only allows standard headers, so the app name
// travels as a query parameter instead of the X-Keenable-Title header.
const APP_TITLE = "Harbor";

type KeenableResult = {
  title?: string;
  url?: string;
  snippet?: string;
};

export async function keenableSearch(query: string, apiKey?: string): Promise<WebHit[]> {
  const q = query.trim();
  if (!q) return [];
  const key = apiKey?.trim();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (key) headers["X-API-Key"] = key;
  const url = `${key ? ENDPOINT : `${ENDPOINT}/public`}?keenable_title=${APP_TITLE}`;
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ query: q, max_results: MAX_RESULTS }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Keenable error (${res.status}). ${body.slice(0, 120)}`);
  }
  const data = (await res.json()) as { results?: KeenableResult[] };
  const hits: WebHit[] = [];
  for (const r of data.results ?? []) {
    const link = r.url?.trim() ?? "";
    if (!/^https?:\/\//.test(link)) continue;
    hits.push({
      title: r.title?.trim() || link,
      url: link,
      snippet: (r.snippet ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_SNIPPET_CHARS),
    });
  }
  return hits.slice(0, MAX_RESULTS);
}

export async function enrichWithKeenable(
  query: string,
  apiKey?: string,
): Promise<{ hits: WebHit[]; context: string }> {
  const hits = await keenableSearch(query, apiKey);
  return { hits, context: hitsToContext(hits) };
}
