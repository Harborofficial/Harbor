import { useSyncExternalStore } from "react";

const API_BASE = "https://api.seekr.tv";

export type SeekrTile = { url: string; x: number; y: number; w: number; h: number };
export type SeekrCue = { start: number; end: number; tile: SeekrTile };
export type SeekrStatus = "idle" | "loading" | "active";
export type SeekrState = { status: SeekrStatus; session: number; error: string | null };
export type SeekrStartInput = {
  apiKey: string;
  metaId: string;
  imdbId?: string | null;
  type?: string;
  season?: number | null;
  episode?: number | null;
  durationSec: number;
};

const IDLE: SeekrState = { status: "idle", session: 0, error: null };

let state = IDLE;
const listeners = new Set<() => void>();
let cues: SeekrCue[] = [];
let scale = 1;
let currentKey = "";
let controller: AbortController | null = null;
let lastInput: SeekrStartInput | null = null;
let lastRefresh = 0;

function setState(next: SeekrState): void {
  state = next;
  for (const listener of listeners) listener();
}

export function useSeekrState(): SeekrState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
    () => IDLE,
  );
}

function imdbFrom(value?: string | null): string | null {
  return value?.match(/tt\d+/)?.[0] ?? null;
}

function tmdbFrom(value?: string | null): number | null {
  if (!value) return null;
  const match = value.match(/^(?:tmdb:)?(?:movie|tv|series):?(\d+)$/i);
  if (match) return Number(match[1]);
  return /^\d+$/.test(value) ? Number(value) : null;
}

/** Builds the Seekr lookup query, or null when the title has no usable id. */
export function seekrQueryFor(input: SeekrStartInput): string | null {
  const durationMs = Math.round(input.durationSec * 1000);
  if (!Number.isFinite(durationMs) || durationMs <= 0) return null;
  const imdb = imdbFrom(input.imdbId) ?? imdbFrom(input.metaId);
  const tmdb = tmdbFrom(input.metaId) ?? tmdbFrom(input.imdbId);
  const season = input.season;
  const episode = input.episode;
  const episodeLookup =
    season != null && episode != null && Number.isInteger(season) && Number.isInteger(episode);
  const isSeries = input.type === "series" || input.type === "tv";
  if (!episodeLookup && isSeries) return null;
  if (episodeLookup) {
    if (imdb) {
      return `duration_ms=${durationMs}&show_imdb_id=${imdb}&season=${season}&episode=${episode}`;
    }
    if (tmdb != null) {
      return `duration_ms=${durationMs}&show_tmdb_id=${tmdb}&season=${season}&episode=${episode}`;
    }
    return null;
  }
  if (imdb) return `duration_ms=${durationMs}&imdb_id=${imdb}`;
  if (tmdb != null) return `duration_ms=${durationMs}&tmdb_id=${tmdb}`;
  return null;
}

function parseTimestamp(text: string): number | null {
  const clean = text.trim().split(/\s+/)[0];
  if (!clean) return null;
  const parts = clean.split(":");
  if (parts.length < 2 || parts.length > 3) return null;
  const numbers = parts.map(Number);
  if (numbers.some((value) => !Number.isFinite(value))) return null;
  const seconds =
    parts.length === 3
      ? numbers[0] * 3600 + numbers[1] * 60 + numbers[2]
      : numbers[0] * 60 + numbers[1];
  return seconds;
}

function parseTile(payload: string, baseUrl?: string): SeekrTile | null {
  const hash = payload.lastIndexOf("#");
  if (hash < 0) return null;
  let url = payload.slice(0, hash).trim();
  const fragment = payload.slice(hash + 1);
  if (!fragment.startsWith("xywh=")) return null;
  const [x, y, w, h] = fragment.slice("xywh=".length).split(",").map(Number);
  if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return null;
  if (baseUrl && !/^https?:\/\//i.test(url)) {
    try {
      const base = new URL(baseUrl);
      base.search = "";
      base.hash = "";
      url = new URL(url, base).toString();
    } catch {
      return null;
    }
  }
  return { url, x, y, w, h };
}

/** Reads the signed WebVTT seek-preview track into timed sprite tiles. */
export function parseSeekrVtt(text: string, baseUrl?: string): SeekrCue[] {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const parsed: SeekrCue[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    const arrow = line.indexOf("-->");
    if (arrow < 0) continue;
    const start = parseTimestamp(line.slice(0, arrow));
    const end = parseTimestamp(line.slice(arrow + 3));
    if (start == null || end == null || end <= start) continue;
    let payload = "";
    for (let j = i + 1; j < lines.length; j += 1) {
      const next = lines[j].trim();
      if (!next) {
        if (payload) break;
        continue;
      }
      if (next.includes("-->")) break;
      if (!payload) payload = next;
    }
    const tile = parseTile(payload, baseUrl);
    if (tile) parsed.push({ start, end, tile });
  }
  parsed.sort((a, b) => a.start - b.start);
  return parsed;
}

export function seekrTileFromCues(
  list: SeekrCue[],
  cueScale: number,
  timeSec: number,
): SeekrTile | null {
  if (list.length === 0) return null;
  const sourceTime = timeSec / (cueScale > 0 ? cueScale : 1);
  if (sourceTime <= list[0].start) return list[0].tile;
  if (sourceTime >= list[list.length - 1].end) return list[list.length - 1].tile;
  let low = 0;
  let high = list.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const cue = list[middle];
    if (sourceTime < cue.start) high = middle - 1;
    else if (sourceTime >= cue.end) low = middle + 1;
    else return cue.tile;
  }
  return null;
}

export function seekrTileAt(timeSec: number): SeekrTile | null {
  if (state.status !== "active") return null;
  return seekrTileFromCues(cues, scale, timeSec);
}

async function getFetch(): Promise<typeof fetch> {
  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
    const { fetch: tauriFetch } = await import("@tauri-apps/plugin-http");
    return tauriFetch as unknown as typeof fetch;
  }
  return fetch;
}

export async function seekrStart(input: SeekrStartInput): Promise<void> {
  lastInput = input;
  const apiKey = input.apiKey.trim();
  const query = seekrQueryFor(input);
  if (!apiKey || !query) {
    seekrStop();
    return;
  }
  const key = `${query}|${apiKey}`;
  if (key === currentKey && (state.status === "active" || state.status === "loading")) return;
  controller?.abort();
  const ac = new AbortController();
  controller = ac;
  currentKey = key;
  setState({ status: "loading", session: state.session + 1, error: null });
  try {
    const fetcher = await getFetch();
    const lookupResponse = await fetcher(`${API_BASE}/sprites?${query}`, {
      headers: { "X-API-Key": apiKey },
      signal: ac.signal,
    });
    if (!lookupResponse.ok) throw new Error(`Seekr lookup failed (${lookupResponse.status})`);
    const lookup = (await lookupResponse.json()) as { vtt_url?: string; scale?: number };
    if (!lookup.vtt_url) throw new Error("Seekr returned no VTT");
    const vttUrl = new URL(lookup.vtt_url, API_BASE).toString();
    const vttResponse = await fetcher(vttUrl, { signal: ac.signal });
    if (!vttResponse.ok) throw new Error(`Seekr VTT failed (${vttResponse.status})`);
    const parsedCues = parseSeekrVtt(await vttResponse.text(), vttUrl);
    if (parsedCues.length === 0) throw new Error("Seekr returned no preview tiles");
    if (ac.signal.aborted) return;
    cues = parsedCues;
    scale = typeof lookup.scale === "number" && lookup.scale > 0 ? lookup.scale : 1;
    if (import.meta.env.DEV) {
      console.info("[harbor/seekr] active", {
        metaId: input.metaId,
        cues: parsedCues.length,
        scale,
      });
    }
    setState({ status: "active", session: state.session + 1, error: null });
  } catch (error) {
    if (ac.signal.aborted) return;
    cues = [];
    scale = 1;
    if (import.meta.env.DEV) {
      console.warn("[harbor/seekr] lookup failed", error);
    }
    setState({
      status: "idle",
      session: state.session + 1,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    if (controller === ac) controller = null;
  }
}

export function seekrStop(): void {
  controller?.abort();
  controller = null;
  currentKey = "";
  cues = [];
  scale = 1;
  lastInput = null;
  if (state.status !== "idle") {
    setState({ status: "idle", session: state.session + 1, error: null });
  }
}

/** A stale signed sprite URL can 403; request a fresh VTT at most once per 20s. */
export function seekrRefresh(): void {
  if (state.status !== "active" || !lastInput) return;
  const now = Date.now();
  if (now - lastRefresh < 20_000) return;
  lastRefresh = now;
  currentKey = "";
  void seekrStart(lastInput);
}
