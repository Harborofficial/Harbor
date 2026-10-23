import { meta as fetchMeta, narrowMediaType, type Meta } from "@/lib/cinemeta";
import { savePlayback } from "@/lib/playback-history";
import { pushWatched } from "@/lib/trakt/history";
import { markEpisodeWatched } from "@/lib/trakt/resolve";
import { stremioIdToTraktTarget } from "@/lib/trakt/ids";
import { getSession as getTraktSession } from "@/lib/trakt/session";
import { activeProfileId, isNuvioProviderActive } from "@/lib/active-profile-id";
import { addToHistory as simklAddToHistory } from "@/lib/simkl/history";
import { markPmdbWatched, unmarkPmdbWatched } from "@/lib/publicmetadb/history";
import { stremioIdToPmdbTarget } from "@/lib/publicmetadb/ids";
import { setMovieWatchedLocal } from "@/lib/movie-watched";
import { recordManualWatchedMeta, setManualWatchedMany } from "@/lib/manual-watched";
import { setWatchedFlag } from "@/lib/watched-flag";
import { recordWatchEvent } from "@/lib/watch-events";
import { readActiveStremioAuthKey } from "@/lib/auth";
import { cloudWriteId } from "@/lib/stremio";
import { markMovieWatchedStremio } from "@/lib/stremio-watched-sync";
import { syncSeriesWatchedToStremio } from "@/lib/stremio-episode-watched";
import { tmdbImdbCached } from "@/lib/providers/tmdb/tmdb-imdb-resolve";
import { airedOnly } from "@/lib/aired";
import { isNuvioSignedIn } from "@/lib/nuvio/nuvio-client";
import {
  resolveNuvioProfileIndex,
  pushWatchedItemToNuvio,
  deleteWatchedItemFromNuvio,
  deleteWatchProgressFromNuvio,
} from "@/lib/nuvio/nuvio-sync";

export async function markMovieWatched(
  meta: Meta,
  imdbId?: string | null,
  tmdbId?: string | number | null,
): Promise<void> {
  setMovieWatchedLocal(meta.id, true);
  savePlayback(meta.id, { title: meta.name, parsedTitle: meta.name });
  recordWatchEvent({
    id: meta.id,
    type: "movie",
    name: meta.name,
    poster: meta.poster,
    at: Date.now(),
  });
  const imdb = imdbId ?? (meta.id.startsWith("tt") ? meta.id : undefined);
  const tmdb = typeof tmdbId === "string" ? Number(tmdbId) || undefined : (tmdbId ?? undefined);
  const authKey = readActiveStremioAuthKey();
  const cid = authKey ? cloudWriteId(meta.id, imdb ?? null, !!imdb) : null;
  const writes: Promise<unknown>[] = [];
  if (authKey && cid) writes.push(markMovieWatchedStremio(authKey, meta, cid, true));
  if (imdb || tmdb) {
    const ids = { ...(imdb ? { imdb } : {}), ...(tmdb ? { tmdb } : {}) };
    writes.push(pushWatched({ kind: "movie", ids }), simklAddToHistory({ kind: "movie", ids }));
  }
  const pmdbTarget = stremioIdToPmdbTarget(meta.id, undefined, "movie");
  if (pmdbTarget) writes.push(markPmdbWatched(pmdbTarget));
  if (isNuvioSignedIn()) {
    if (isNuvioProviderActive()) {
      const slot = resolveNuvioProfileIndex();
      const primaryId = imdb ?? (meta.id.startsWith("tt") ? meta.id : meta.id);
      const altId = meta.id !== primaryId ? meta.id : undefined;
      writes.push(
        pushWatchedItemToNuvio(slot, [
          {
            contentId: primaryId,
            contentType: "movie",
            title: meta.name,
            watchedAt: Date.now(),
          },
          ...(altId
            ? [
                {
                  contentId: altId,
                  contentType: "movie",
                  title: meta.name,
                  watchedAt: Date.now(),
                },
              ]
            : []),
        ]),
        deleteWatchProgressFromNuvio(slot, primaryId),
      );
      if (altId) writes.push(deleteWatchProgressFromNuvio(slot, altId));
    }
  }
  await Promise.allSettled(writes);
}

export async function unmarkMovieWatched(meta: Meta, imdbId?: string | null): Promise<void> {
  setMovieWatchedLocal(meta.id, false);
  setWatchedFlag(meta.id, false);
  const imdb = imdbId ?? (meta.id.startsWith("tt") ? meta.id : undefined);
  const authKey = readActiveStremioAuthKey();
  const cid = authKey ? cloudWriteId(meta.id, imdb ?? null, !!imdb) : null;
  const pmdbTarget = stremioIdToPmdbTarget(meta.id, undefined, "movie");
  const writes: Promise<unknown>[] = [];
  if (authKey && cid) writes.push(markMovieWatchedStremio(authKey, meta, cid, false));
  if (pmdbTarget) writes.push(unmarkPmdbWatched(pmdbTarget));
  if (isNuvioSignedIn()) {
    if (isNuvioProviderActive()) {
      const slot = resolveNuvioProfileIndex();
      const primaryId = imdb ?? (meta.id.startsWith("tt") ? meta.id : meta.id);
      const altId = meta.id !== primaryId ? meta.id : undefined;
      writes.push(
        deleteWatchedItemFromNuvio(slot, [
          { contentId: primaryId },
          ...(altId ? [{ contentId: altId }] : []),
        ]),
      );
    }
  }
  await Promise.allSettled(writes);
}

function resolveSeriesImdb(meta: Meta, imdbId?: string | null): string | null {
  if (imdbId?.startsWith("tt")) return imdbId;
  if (meta.id.startsWith("tt")) return meta.id;
  const cached = tmdbImdbCached(meta.id);
  return cached?.startsWith("tt") ? cached : null;
}

async function releasedEpisodes(
  meta: Meta,
  imdbId?: string | null,
): Promise<Array<{ season: number; episode: number }>> {
  const fetchId = resolveSeriesImdb(meta, imdbId) ?? meta.id;
  const source = meta.videos?.length
    ? meta
    : ((await fetchMeta("series", fetchId).catch(() => null)) ?? meta);
  const ordered: Array<{ season: number; episode: number; rel: string | null }> = [];
  for (const v of source.videos ?? []) {
    const season = v.season ?? 0;
    const episode = v.episode ?? v.number;
    if (season < 1 || episode == null) continue;
    ordered.push({ season, episode, rel: v.released ?? v.firstAired ?? null });
  }
  ordered.sort((a, b) => a.season - b.season || a.episode - b.episode);
  return airedOnly(ordered, (v) => v.rel).map(({ season, episode }) => ({ season, episode }));
}

export async function markMetaWatched(
  meta: Meta,
  imdbId?: string | null,
  tmdbId?: string | number | null,
): Promise<void> {
  setWatchedFlag(meta.id, true);
  if (narrowMediaType(meta.type) === "movie") {
    await markMovieWatched(meta, imdbId, tmdbId);
    return;
  }
  recordManualWatchedMeta(meta.id, {
    type: "series",
    name: meta.name,
    poster: meta.poster,
    background: meta.background,
    markedAt: new Date().toISOString(),
  });
  recordWatchEvent({
    id: meta.id,
    type: "series",
    name: meta.name,
    poster: meta.poster,
    at: Date.now(),
  });
  const ownerProfile = activeProfileId();
  const ownerSession = getTraktSession();
  const resolvedImdb = resolveSeriesImdb(meta, imdbId);
  const eps = await releasedEpisodes(meta, resolvedImdb);
  if (activeProfileId() !== ownerProfile) return;
  if (eps.length > 0) setManualWatchedMany(meta.id, eps, true);
  void syncSeriesWatchedToStremio(meta, resolvedImdb);
  const isAnime = /^(kitsu|mal|anilist|anidb):/.test(meta.id);
  const imdb = resolvedImdb ?? (meta.id.startsWith("tt") ? meta.id : undefined);
  const tmdb = typeof tmdbId === "string" ? Number(tmdbId) || undefined : (tmdbId ?? undefined);
  if (!isAnime && eps.length > 0) {
    for (const episode of eps) {
      if (activeProfileId() !== ownerProfile || getTraktSession() !== ownerSession) break;
      const resolved = stremioIdToTraktTarget(imdb ?? meta.id, episode);
      if (resolved.ok) await markEpisodeWatched(resolved.target, imdb ?? meta.id);
    }
  }
  if (activeProfileId() === ownerProfile && !isAnime && (imdb || tmdb)) {
    const ids = { ...(imdb ? { imdb } : {}), ...(tmdb ? { tmdb } : {}) };
    await simklAddToHistory({ kind: "show", ids }, meta.id);
  }
  for (const episode of eps) {
    const target = stremioIdToPmdbTarget(imdb ?? meta.id, episode, "tv");
    if (target) void markPmdbWatched(target);
  }
  if (isNuvioSignedIn()) {
    if (isNuvioProviderActive() && eps.length > 0) {
      const slot = resolveNuvioProfileIndex();
      const primaryId = imdb ?? (meta.id.startsWith("tt") ? meta.id : meta.id);
      const altId = meta.id !== primaryId ? meta.id : undefined;
      const items = eps.flatMap((e) => [
        {
          contentId: primaryId,
          contentType: "series" as const,
          title: meta.name,
          season: e.season,
          episode: e.episode,
          watchedAt: Date.now(),
        },
        ...(altId
          ? [
              {
                contentId: altId,
                contentType: "series" as const,
                title: meta.name,
                season: e.season,
                episode: e.episode,
                watchedAt: Date.now(),
              },
            ]
          : []),
      ]);
      void pushWatchedItemToNuvio(slot, items);
    }
  }
}

export async function unmarkMetaWatched(meta: Meta, imdbId?: string | null): Promise<void> {
  setWatchedFlag(meta.id, false);
  if (narrowMediaType(meta.type) === "movie") {
    await unmarkMovieWatched(meta, imdbId);
    return;
  }
  const resolvedImdb = resolveSeriesImdb(meta, imdbId);
  const eps = await releasedEpisodes(meta, resolvedImdb);
  if (eps.length > 0) setManualWatchedMany(meta.id, eps, false);
  void syncSeriesWatchedToStremio(meta, resolvedImdb);
  for (const episode of eps) {
    const target = stremioIdToPmdbTarget(resolvedImdb ?? meta.id, episode, "tv");
    if (target) void unmarkPmdbWatched(target);
  }
  if (isNuvioSignedIn()) {
    if (isNuvioProviderActive() && eps.length > 0) {
      const slot = resolveNuvioProfileIndex();
      const primaryId = resolvedImdb ?? (meta.id.startsWith("tt") ? meta.id : meta.id);
      const altId = meta.id !== primaryId ? meta.id : undefined;
      const keys = eps.flatMap((e) => [
        { contentId: primaryId, season: e.season, episode: e.episode },
        ...(altId ? [{ contentId: altId, season: e.season, episode: e.episode }] : []),
      ]);
      void deleteWatchedItemFromNuvio(slot, keys);
    }
  }
}
