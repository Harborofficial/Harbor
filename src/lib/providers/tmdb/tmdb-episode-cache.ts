/**
 * Episode data caching with TTL and LRU eviction
 * Caches episode details to reduce TMDB API calls and improve performance
 */

import { lruSet } from "@/lib/cache";
import { onMediaCacheClear, MEDIA_TTL } from "@/lib/media-cache";
import type { EpisodeDetail, EpisodeCacheEntry } from "./tmdb-episode-types";

const CACHE_DURATION_MS = MEDIA_TTL.episodes; // 12 hours
const MAX_CACHE_SIZE = 100; // Maximum number of cached episodes

const expiry = new Map<string, number>();
const episodeCache = new Map<string, EpisodeCacheEntry>();
onMediaCacheClear(() => {
  episodeCache.clear();
  expiry.clear();
});

/**
 * Generate cache key for an episode
 * Format: episode:${seriesId}:${season}:${episode}
 */
function getCacheKey(seriesId: string, season: number, episode: number, scope: string): string {
  return `episode:${scope}:${seriesId}:${season}:${episode}`;
}

/**
 * Retrieve cached episode data if available and not expired
 * @returns Episode data if cached and valid, null if expired or not found
 */
export function getCachedEpisode(
  seriesId: string,
  season: number,
  episode: number,
  scope = "",
): EpisodeDetail | null {
  const key = getCacheKey(seriesId, season, episode, scope);
  const cached = episodeCache.get(key);

  if (!cached) return null;

  // Check if cache entry has expired
  const age = Date.now() - cached.timestamp;
  if (age > (expiry.get(key) ?? CACHE_DURATION_MS)) {
    episodeCache.delete(key);
    return null;
  }

  return cached.data;
}

/**
 * Cache episode data with current timestamp
 * Implements LRU eviction when cache size exceeds maximum
 */
export function cacheEpisode(
  seriesId: string,
  season: number,
  episode: number,
  data: EpisodeDetail,
  scope = "",
  ttl = CACHE_DURATION_MS,
): void {
  const key = getCacheKey(seriesId, season, episode, scope);
  const entry: EpisodeCacheEntry = {
    data,
    timestamp: Date.now(),
    seriesId,
  };

  // Use LRU set to handle eviction automatically
  lruSet(episodeCache, key, entry, MAX_CACHE_SIZE);
  for (const held of expiry.keys()) if (!episodeCache.has(held)) expiry.delete(held);
  expiry.set(key, ttl);
}

/**
 * Clear all cached episode data
 * Useful for testing or when user wants to refresh all data
 */
export function clearEpisodeCache(): void {
  episodeCache.clear();
  expiry.clear();
}

/**
 * Get current cache statistics (for debugging/monitoring)
 */
export function getEpisodeCacheStats(): {
  size: number;
  maxSize: number;
  ttlMs: number;
} {
  return {
    size: episodeCache.size,
    maxSize: MAX_CACHE_SIZE,
    ttlMs: CACHE_DURATION_MS,
  };
}
