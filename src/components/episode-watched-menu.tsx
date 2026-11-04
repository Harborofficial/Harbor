import { Ban, Check, Eye, EyeOff, ListPlus } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { useT } from "@/lib/i18n";
import {
  manualWatchedState,
  subscribeManualWatched,
  type ManualWatchedMeta,
} from "@/lib/manual-watched";
import { isEpisodeHidden, setEpisodeHidden } from "@/lib/hidden-episodes";
import { useSettings } from "@/lib/settings";
import { useProfiles } from "@/lib/profiles";
import { clearResume, readResumeEntry } from "@/lib/resume";
import { useTmdbImdbId } from "@/lib/providers/tmdb";
import {
  setContextWatched,
  requireMediaActionSuccess,
  type WatchedEpisode,
} from "@/lib/media-context-actions";
import type { ContextAction } from "@/lib/context-actions";
import { MenuSurface } from "./context-menu/menu-surface";
import { ActionItems } from "./context-menu/action-items";
import { useLocalMenuPresence } from "./context-menu/use-local-menu-presence";
import type { Meta } from "@/lib/cinemeta";
import type { PlayEpisode } from "@/lib/view";
import { queueAdd, queueIndexOf, useQueue } from "@/lib/queue";
import { useQueueSurface } from "@/hooks/use-queue-surface";

export type WatchedMenuTarget = {
  x: number;
  y: number;
  season: number;
  episode: number;
  watched: boolean;
  metaId?: string;
  absoluteNumber?: number;
  origin?: HTMLElement | null;
  queueTarget?: {
    meta: Meta;
    episode: PlayEpisode;
  };
};

/** Caller-supplied scope for lists whose numbering repeats, such as anime cours. */
export type EpisodeUpToScope = {
  count: number;
  markWatched: () => void | Promise<void>;
};

function airedByNow(released?: string | null): boolean {
  if (!released) return true;
  const date = Date.parse(released);
  return !Number.isFinite(date) || date <= Date.now();
}

export function EpisodeWatchedMenu({
  metaId,
  syncMetaId,
  imdbId: propImdbId,
  meta,
  target,
  allEpisodes,
  upToScope,
  onClose,
}: {
  metaId: string;
  syncMetaId?: string;
  imdbId?: string | null;
  meta: ManualWatchedMeta;
  target: WatchedMenuTarget;
  allEpisodes?: Array<WatchedEpisode & { released?: string | null }>;
  upToScope?: EpisodeUpToScope;
  onClose: () => void;
}) {
  const t = useT();
  const queueSurface = useQueueSurface();
  useQueue();
  const { settings } = useSettings();
  const { activeId } = useProfiles();
  const identity = useMemo(() => ({ metaId, target }), [metaId, target]);
  const presence = useLocalMenuPresence(true, identity, onClose);
  const initialProfile = useRef(activeId);
  const origin = useRef(
    target.origin ??
      (document.activeElement instanceof HTMLElement ? document.activeElement : null),
  );
  const resolvedImdb = useTmdbImdbId(metaId);
  const imdbId = propImdbId ?? resolvedImdb;
  const originSession = useRef(presence.session);
  if (presence.enabled && originSession.current !== presence.session) {
    originSession.current = presence.session;
    origin.current =
      target.origin ??
      (document.activeElement instanceof HTMLElement ? document.activeElement : null);
  }
  const close = (restoreFocus = true) => {
    if (!presence.close()) return;
    if (restoreFocus && origin.current?.isConnected) origin.current.focus({ preventScroll: true });
  };
  useEffect(() => {
    if (activeId !== initialProfile.current) {
      if (presence.enabled) presence.close();
      else onClose();
    }
  }, [activeId, onClose]);
  const runWatched = async (watched: boolean, episodes?: WatchedEpisode[]) => {
    const result = await setContextWatched(
      {
        id: metaId,
        ...meta,
        type: "series",
        videos: allEpisodes?.map((e) => ({
          season: e.season,
          episode: e.episode,
          number: e.episode,
          released: e.released ?? undefined,
        })),
      },
      watched,
      {
        imdbId,
        syncMetaId,
        ...(episodes
          ? { episodes }
          : {
              episode: {
                season: target.season,
                episode: target.episode,
                absoluteNumber: target.absoluteNumber,
              },
            }),
      },
    );
    if (
      !watched &&
      result.outcomes.some(
        (outcome) => outcome.provider === "Harbor" && outcome.status === "updated",
      )
    )
      clearResume(metaId, target.season, target.episode);
    requireMediaActionSuccess(result);
  };
  const actions = (): ContextAction[] => {
    const watched =
      manualWatchedState(metaId, target.season, target.episode, [imdbId, syncMetaId]) ??
      target.watched;
    const started = !watched && readResumeEntry(metaId, target.season, target.episode) != null;
    const targetSeason = target.season;
    const targetEpisode = target.episode;
    const upTo = upToScope
      ? []
      : [
          ...new Map(
            (allEpisodes ?? [])
              .filter((episode) => {
                if (!airedByNow(episode.released)) return false;
                if (targetSeason > 0 && episode.season <= 0) return false;
                if (targetSeason === 0 && episode.season !== 0) return false;
                return (
                  episode.season < targetSeason ||
                  (episode.season === targetSeason && episode.episode <= targetEpisode)
                );
              })
              .sort((a, b) => a.season - b.season || a.episode - b.episode)
              .map((episode) => [
                episode.season + ":" + episode.episode,
                {
                  season: episode.season,
                  episode: episode.episode,
                  absoluteNumber: episode.absoluteNumber,
                },
              ]),
          ).values(),
        ];
    const upToCount = upToScope?.count ?? upTo.length;
    const result: ContextAction[] = [];
    const selected = target.queueTarget;
    if (queueSurface && selected) {
      const queued = queueIndexOf(selected.meta, selected.episode) >= 0;
      result.push({
        id: "episode:add-to-queue",
        icon: queued ? <Check size={14} /> : <ListPlus size={14} />,
        label: queued ? t("In your queue") : t("Add to queue"),
        disabled: queued,
        group: "queue",
        run: () => {
          queueAdd(selected.meta, selected.episode);
        },
      });
    }
    if (!watched) {
      result.push({
        id: "episode:watched",
        icon: <Check size={14} />,
        label: t("Mark episode as watched"),
        run: () => runWatched(true),
        group: "watched",
      });
      result.push({
        id: "episode:up-to",
        icon: <Eye size={14} />,
        label: t("Mark {count} episodes up to here", { count: upToCount }),
        disabled: upToCount === 0,
        reason: upToCount ? undefined : t("Episode information is unavailable."),
        run: upToScope ? upToScope.markWatched : () => runWatched(true, upTo),
        group: "watched",
      });
    }
    if (watched || started)
      result.push({
        id: "episode:unwatched",
        icon: <EyeOff size={14} />,
        label: t("Mark episode as unwatched"),
        run: () => runWatched(false),
        group: "watched",
      });
    if (settings.episodeHiding) {
      const hidden = isEpisodeHidden(metaId, target.season, target.episode);
      result.push({
        id: "episode:hidden",
        icon: hidden ? <Eye size={14} /> : <Ban size={14} />,
        label: hidden ? t("Show episode") : t("Hide episode"),
        run: () =>
          setEpisodeHidden(
            metaId,
            target.season,
            target.episode,
            !isEpisodeHidden(metaId, target.season, target.episode),
          ),
        group: "visibility",
      });
    }
    return result;
  };
  const latest = useRef(actions);
  latest.current = actions;
  if (!presence.present) return null;
  return (
    <MenuSurface
      key={presence.session}
      point={{ x: target.x, y: target.y }}
      onClose={close}
      label={t("Episode actions")}
      phase={presence.phase}
      onExitComplete={presence.completeClose}
    >
      <ActionItems
        source={{
          actions: () => latest.current(),
          isValid: () => activeId === initialProfile.current && presence.isOpen(),
          subscribe: subscribeManualWatched,
        }}
        onClose={close}
      />
    </MenuSurface>
  );
}
