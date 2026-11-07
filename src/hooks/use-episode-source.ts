import { useEffect, useState } from "react";
import type { Meta } from "@/lib/cinemeta";
import { metadataAddons, resolveAddonMetaSource } from "@/lib/meta-resource";
import { addonKeyFromSource, normalizeMetadataSourceChain } from "@/lib/metadata-sources";
import type { Season, TmdbDetail } from "@/lib/providers/tmdb";
import { tmdbDetails } from "@/lib/providers/tmdb";
import { tmdbLanguageIso } from "@/lib/providers/tmdb/tmdb-client";
import { fetchTvdbOrder } from "@/lib/providers/tvdb-order";
import { tvdbLangFromIso1 } from "@/lib/providers/tvdb";
import type { Settings } from "@/lib/settings";

export type EpisodeSource = {
  kind: "addon" | "tmdb" | "tvdb";
  sourceName: string;
  videos?: NonNullable<Meta["videos"]>;
  detail?: TmdbDetail;
  seasons?: Season[];
  imdbId?: string | null;
};

type ScopedSource = { key: string; source: EpisodeSource | null };

function tvdbRemoteId(meta: Meta, detail: TmdbDetail | null): string | null {
  const imdb = detail?.imdbId ?? (meta.id.startsWith("tt") ? meta.id.split(":")[0] : null);
  if (imdb?.startsWith("tt")) return imdb;
  if (meta.id.startsWith("tmdb:tv:")) return meta.id.slice(8);
  return detail?.tmdbTvId ? String(detail.tmdbTvId) : null;
}

export function useEpisodeSource({
  authKey,
  meta,
  detail,
  settings,
}: {
  authKey: string | null;
  meta: Meta;
  detail: TmdbDetail | null;
  settings: Settings;
}): EpisodeSource | null {
  const identityKey = JSON.stringify([
    authKey,
    meta.id,
    meta.name,
    meta.type,
    detail?.id,
    detail?.imdbId,
    detail?.kind,
    detail?.seasons?.length,
    detail?.tmdbTvId,
    settings.addonOnlyMetadata,
    settings.metadataSources,
    settings.tmdbKey,
    settings.tvdbKey,
    settings.tvdbSeasonType,
  ]);
  const [state, setState] = useState<ScopedSource>({ key: "", source: null });
  const source = state.key === identityKey ? state.source : null;

  useEffect(() => {
    const key = identityKey;
    let cancelled = false;
    const publish = (next: EpisodeSource | null) => {
      if (!cancelled) setState({ key, source: next });
    };
    publish(null);
    if (!settings.addonOnlyMetadata) return;
    void (async () => {
      const addons = await metadataAddons(authKey, []).catch(() => []);
      const chain = normalizeMetadataSourceChain(
        "episodes",
        settings.metadataSources?.episodes,
        addons,
        settings,
      );
      const baseMeta = { id: meta.id, type: meta.type, name: meta.name };
      const tmdbLookup =
        detail?.kind === "tv" && detail.tmdbTvId
          ? { ...baseMeta, id: `tmdb:tv:${detail.tmdbTvId}` }
          : detail?.kind === "movie" && detail.id > 0
            ? { ...baseMeta, id: `tmdb:movie:${detail.id}` }
            : baseMeta;
      let tmdb: TmdbDetail | null = null;
      const loadTmdb = async () => {
        if (tmdb || !settings.tmdbKey) return tmdb;
        tmdb = await tmdbDetails(settings.tmdbKey, tmdbLookup).catch(() => null);
        return tmdb;
      };
      for (const id of chain) {
        const addonKey = addonKeyFromSource(id);
        if (addonKey) {
          const found = await resolveAddonMetaSource(
            authKey,
            meta.type === "movie" ? "movie" : "series",
            meta.id,
            addonKey,
          ).catch(() => null);
          if (cancelled) return;
          const videos = found?.videos;
          if (videos?.some((video) => video.season != null && video.episode != null)) {
            publish({
              kind: "addon",
              sourceName: found?.addonOrigin?.name ?? "Addon",
              videos,
            });
            return;
          }
          continue;
        }
        if (id === "tmdb") {
          const found = await loadTmdb();
          if (cancelled) return;
          if (found && found.seasons.length > 0) {
            publish({ kind: "tmdb", sourceName: "TMDB", detail: found });
            return;
          }
          continue;
        }
        if (id === "tvdb") {
          if (!settings.tvdbKey || settings.tvdbSeasonType === "tmdb") continue;
          const remoteId = tvdbRemoteId(meta, detail);
          if (!remoteId) continue;
          const order = await fetchTvdbOrder(
            settings.tvdbKey,
            remoteId,
            settings.tvdbSeasonType || "official",
            tvdbLangFromIso1(tmdbLanguageIso()),
          ).catch(() => null);
          if (cancelled) return;
          if (!order || order.bySeason.size === 0) continue;
          publish({
            kind: "tvdb",
            sourceName: "TheTVDB",
            detail: (await loadTmdb()) ?? detail ?? undefined,
            seasons: order.seasons,
            imdbId: detail?.imdbId ?? (meta.id.startsWith("tt") ? meta.id.split(":")[0] : null),
          });
          return;
        }
      }
      publish(null);
    })();
    return () => {
      cancelled = true;
    };
  }, [
    authKey,
    detail,
    identityKey,
    meta.id,
    meta.name,
    meta.type,
    settings.addonOnlyMetadata,
    settings.metadataSources,
    settings.tmdbKey,
    settings.tvdbKey,
    settings.tvdbSeasonType,
  ]);

  return source;
}
