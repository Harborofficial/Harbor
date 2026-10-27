import { useSyncExternalStore } from "react";
import type { AddonProgress } from "./streams/addons";
import type { PlayerSrc } from "./view";
import type { PlaybackAudioChoice } from "./player/audio-choice";
import type { PlaybackSubtitleChoice } from "./player/subtitle-choice";
import {
  persistablePlaybackSource,
  persistablePlaybackSubtitle,
  persistablePlaybackUrl,
  playbackUrlFingerprint,
  persistablePlaybackFields,
  persistablePlaybackIdentity,
  persistablePlaybackPreference,
} from "./player/playback-history-source";
import { noteNotify } from "./render-cause";
import { subtitleMediaKey, subtitleStreamKey } from "./subtitles/subtitle-memory";
import {
  activeScopedProfileId,
  isNuvioProviderActive,
  stremioProfileId,
} from "./active-profile-id";
import { cwProfileScope } from "./cw-profile";

type ActualPlaybackState = { actual?: ActualPlayback };

export type PlaybackEntry = {
  infoHash?: string | null;
  fileIdx?: number | null;
  addonId?: string | null;
  url?: string | null;
  urlFingerprint?: string;
  title?: string | null;
  parsedTitle?: string | null;
  resolution?: string | null;
  releaseGroup?: string | null;
  source?: string | null;
  audioLanguages?: string[] | null;
  size?: number | null;
  bingeGroup?: string | null;
  cachedSlugs?: string[];
  savedAt: number;
  /** Written by observed player activity, never by source selection or watched edits. */
  actual?: ActualPlayback;
  /** Same history, with observed ownership retained when private CW is enabled. */
  actualByProfile?: Record<string, ActualPlaybackState>;
};

export type PlaybackActor = {
  profileId: string;
  storageProfileId: string;
  accountId: string | null;
  provider?: "nuvio";
  privateCw?: boolean;
};

export type ActualPlayback = {
  id: string;
  actor: PlaybackActor;
  playedAt: number;
  positionMs: number;
  durationMs: number;
  completed: boolean;
  src: Omit<PlayerSrc, "continuation">;
  sourceFingerprint?: string;
  requiresSourceRefresh?: boolean;
  audioTrack?: PlaybackAudioChoice;
  subtitle?: PlaybackSubtitleChoice;
  subDelaySec?: number;
  audioDelaySec?: number;
};

export type PlaybackContinuation = {
  id: string;
  positionMs: number;
  source: Omit<PlaybackEntry, "actual">;
  sourceKey: string;
  target?: { metaId: string; season?: number; episode?: number };
  actor: PlaybackActor;
  restart?: boolean;
  audioTrack?: PlaybackAudioChoice;
  subtitle?: PlaybackSubtitleChoice;
  subDelaySec?: number;
  audioDelaySec?: number;
};

const STORAGE_KEY_PREFIX = "harbor.playback-history.v1.";
const LEGACY_STORAGE_KEY = "harbor.playback-history.v1";
const PROFILES_KEY = "harbor.profiles.v1";
const TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 200;

const listeners = new Set<() => void>();
let playbackRevision = 0;

export function getPlaybackRevision(): number {
  return playbackRevision;
}

function notifyPlayback(): void {
  playbackRevision += 1;
  noteNotify("store:playback");
  listeners.forEach((listener) => listener());
}

function nuvioAccountId(): string | null {
  try {
    const raw =
      localStorage.getItem("harbor.nuvio.state.v1") ?? localStorage.getItem("harbor.nuvio.state");
    const userId = JSON.parse(raw ?? "null")?.session?.user?.id;
    return typeof userId === "string" && userId ? userId : null;
  } catch {
    return null;
  }
}

export function capturePlaybackActor(): PlaybackActor {
  if (isNuvioProviderActive()) {
    const profileId = activeScopedProfileId();
    return {
      profileId,
      storageProfileId: profileId,
      accountId: nuvioAccountId(),
      provider: "nuvio",
    };
  }
  const storageProfileId = activeProfileId();
  try {
    const state = JSON.parse(localStorage.getItem(PROFILES_KEY) ?? "null") as {
      activeId?: string;
    } | null;
    const session = JSON.parse(
      localStorage.getItem(`harbor.auth.${storageProfileId}`) ?? "null",
    ) as {
      user?: { _id?: string };
    } | null;
    return {
      profileId: state?.activeId ?? storageProfileId,
      storageProfileId,
      accountId: session?.user?._id ?? null,
      ...(cwProfileScope().private ? { privateCw: true } : {}),
    };
  } catch {
    return { profileId: storageProfileId, storageProfileId, accountId: null };
  }
}

export function isPlaybackActorCurrent(actor: PlaybackActor): boolean {
  const current = capturePlaybackActor();
  return (
    current.profileId === actor.profileId &&
    current.storageProfileId === actor.storageProfileId &&
    current.accountId === actor.accountId &&
    current.provider === actor.provider &&
    !!current.privateCw === !!actor.privateCw
  );
}

function activeProfileId(): string {
  return stremioProfileId();
}

function primaryProfileId(): string {
  try {
    const raw = localStorage.getItem(PROFILES_KEY);
    const s = raw
      ? (JSON.parse(raw) as { profiles?: Array<{ id?: string; isPrimary?: boolean }> })
      : null;
    const primary = s?.profiles?.find((p) => p?.isPrimary);
    return (primary && typeof primary.id === "string" && primary.id) || activeProfileId();
  } catch {
    return activeProfileId();
  }
}

function storeKey(): string {
  if (isNuvioProviderActive()) {
    return `${STORAGE_KEY_PREFIX}nuvio.${encodeURIComponent(nuvioAccountId() ?? "anon")}.${activeScopedProfileId()}`;
  }
  const id = activeProfileId();
  return id ? STORAGE_KEY_PREFIX + id : LEGACY_STORAGE_KEY;
}

function migrateLegacy(): void {
  if (isNuvioProviderActive()) return;
  try {
    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!legacy) return;
    const pid = primaryProfileId();
    if (!pid) return;
    const perKey = STORAGE_KEY_PREFIX + pid;
    if (!localStorage.getItem(perKey)) localStorage.setItem(perKey, legacy);
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    /* noop */
  }
}

const scopeEvents = [
  "storage",
  "harbor:active-profile-changed",
  "harbor:profiles-updated",
  "harbor:settings-changed",
  "harbor:nuvio-profile-changed",
  "harbor:nuvio-state-changed",
  "harbor:account-provider-changed",
];
let stopScopeEvents: (() => void) | null = null;

export function subscribePlayback(fn: () => void): () => void {
  if (!stopScopeEvents && typeof window !== "undefined") {
    const target = window;
    let actorKey = JSON.stringify(capturePlaybackActor());
    const onScopeChange = () => {
      const next = JSON.stringify(capturePlaybackActor());
      if (next === actorKey) return;
      actorKey = next;
      notifyPlayback();
    };
    for (const event of scopeEvents) target.addEventListener(event, onScopeChange);
    stopScopeEvents = () => {
      for (const event of scopeEvents) target.removeEventListener(event, onScopeChange);
    };
  }
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
    if (listeners.size === 0) {
      stopScopeEvents?.();
      stopScopeEvents = null;
    }
  };
}

function samePlaybackOwner(actual: ActualPlayback, actor: PlaybackActor): boolean {
  return (
    validActualPlayback(actual) &&
    Date.now() - actual.playedAt <= TTL_MS &&
    actual.actor.provider === actor.provider &&
    actual.actor.storageProfileId === actor.storageProfileId &&
    actual.actor.accountId === actor.accountId
  );
}

function retainedActualProfiles(
  entry: PlaybackEntry | undefined,
  actor: PlaybackActor,
): Record<string, ActualPlaybackState> {
  let profileIds = new Set([actor.profileId]);
  if (!actor.provider) {
    try {
      const roster = JSON.parse(localStorage.getItem(PROFILES_KEY) ?? "null") as {
        profiles?: Array<{ id: string }>;
      } | null;
      profileIds = new Set([
        actor.profileId,
        ...(roster?.profiles ?? []).map((profile) => profile.id),
      ]);
    } catch {
      // Keep existing slots if the roster is temporarily unavailable.
      profileIds = new Set([actor.profileId, ...Object.keys(entry?.actualByProfile ?? {})]);
    }
  }
  return Object.fromEntries(
    Object.entries(entry?.actualByProfile ?? {}).filter(
      ([profileId, state]) =>
        profileIds.has(profileId) &&
        !!state?.actual &&
        validActualPlayback(state.actual) &&
        state.actual.actor.profileId === profileId &&
        Date.now() - state.actual.playedAt <= TTL_MS,
    ),
  );
}

function ownActualState(
  entry: PlaybackEntry | undefined,
  actor: PlaybackActor,
): ActualPlaybackState {
  const own = entry?.actualByProfile?.[actor.profileId];
  if (
    own?.actual &&
    own.actual.actor?.profileId === actor.profileId &&
    samePlaybackOwner(own.actual, actor)
  )
    return { actual: own.actual };
  // Old shared entries establish private ownership only through the observed actor.
  return entry?.actual?.actor?.profileId === actor.profileId &&
    samePlaybackOwner(entry.actual, actor)
    ? { actual: entry.actual }
    : {};
}

function selectedActualState(
  entry: PlaybackEntry | undefined,
  actor: PlaybackActor,
): ActualPlaybackState {
  const state = actor.privateCw ? ownActualState(entry, actor) : entry;
  return state?.actual && samePlaybackOwner(state.actual, actor) ? { actual: state.actual } : {};
}

function entryKey(metaId: string, season?: number, episode?: number): string {
  metaId = persistablePlaybackIdentity(metaId);
  if (typeof season === "number" && typeof episode === "number") {
    return `${metaId}|s${season}e${episode}`;
  }
  return metaId;
}

function legacyEntryKey(key: string, entry: PlaybackEntry): string {
  const observations = [
    entry.actual,
    ...Object.values(entry.actualByProfile ?? {}).map((state) => state?.actual),
  ];
  for (const actual of observations) {
    const id = actual?.src?.meta?.id;
    if (typeof id !== "string") continue;
    const episode = actual?.src?.episode;
    const suffix =
      typeof episode?.season === "number" && typeof episode?.episode === "number"
        ? `|s${episode.season}e${episode.episode}`
        : "";
    if (key === `${id}${suffix}`) return entryKey(id, episode?.season, episode?.episode);
  }
  if (typeof entry.url === "string" && key === `url:${entry.url}`) return entryKey(key);
  const suffix = /^(.*)(\|s\d+e\d+)$/.exec(key);
  return suffix
    ? `${persistablePlaybackIdentity(suffix[1])}${suffix[2]}`
    : persistablePlaybackIdentity(key);
}

function readAll(includeExpired = false): Record<string, PlaybackEntry> {
  migrateLegacy();
  try {
    const raw = localStorage.getItem(storeKey());
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, PlaybackEntry>;
    const now = Date.now();
    const fresh: Record<string, PlaybackEntry> = Object.create(null);
    let scrubbed = false;
    for (const [k, v] of Object.entries(parsed)) {
      if (!v) continue;
      const key = legacyEntryKey(k, v);
      const safe = persistableEntry(v, key);
      scrubbed ||= key !== k || JSON.stringify(safe) !== JSON.stringify(v);
      if (!includeExpired && (!v.savedAt || now - v.savedAt > TTL_MS)) continue;
      const previous = fresh[key];
      fresh[key] = previous ? mergeHistoryEntries(previous, safe) : safe;
    }
    if (scrubbed) {
      try {
        localStorage.setItem(storeKey(), JSON.stringify(fresh));
      } catch {
        // Reads remain safe when storage is unavailable; a later read can retry.
      }
    }
    return fresh;
  } catch {
    return {};
  }
}

function newerActual(
  a: ActualPlayback | undefined,
  b: ActualPlayback | undefined,
): ActualPlayback | undefined {
  if (!a || !validActualPlayback(a)) return b;
  if (!b || !validActualPlayback(b)) return a;
  return a.playedAt >= b.playedAt ? a : b;
}

// A partially migrated key can coexist with its old URL-derived spelling.
// Preserve each profile's observed session when those keys converge.
function mergeHistoryEntries(a: PlaybackEntry, b: PlaybackEntry): PlaybackEntry {
  const profiles: Record<string, ActualPlaybackState> = Object.assign(
    Object.create(null),
    a.actualByProfile,
  );
  for (const [id, state] of Object.entries(b.actualByProfile ?? {})) {
    const actual = newerActual(profiles[id]?.actual, state.actual);
    profiles[id] = { ...state, ...(actual ? { actual } : {}) };
  }
  return {
    ...(a.savedAt >= b.savedAt ? a : b),
    actual: newerActual(a.actual, b.actual),
    ...(Object.keys(profiles).length ? { actualByProfile: profiles } : {}),
  };
}

function writeAll(map: Record<string, PlaybackEntry>): void {
  try {
    const keys = Object.keys(map);
    if (keys.length > MAX_ENTRIES) {
      const sorted = Object.entries(map).sort((a, b) => b[1].savedAt - a[1].savedAt);
      map = Object.fromEntries(sorted.slice(0, MAX_ENTRIES));
    }
    localStorage.setItem(storeKey(), JSON.stringify(persistableEntries(map)));
  } catch {
    // A failed replacement must leave the last persisted source/session intact.
    return;
  }
  notifyPlayback();
}

export function playbackHistoryRawKeys(): string[] {
  // Statistics inspect every retained key; only regular history reads apply TTL.
  return Object.keys(readAll(true));
}

export function savePlayback(
  metaId: string,
  entry: Omit<PlaybackEntry, "savedAt">,
  season?: number,
  episode?: number,
): void {
  const all = readAll();
  const key = entryKey(metaId, season, episode);
  const prev = all[key];
  const thin = !entry.infoHash && !entry.addonId && !entry.url;
  all[key] =
    thin && prev
      ? {
          ...prev,
          title: entry.title ?? prev.title,
          parsedTitle: entry.parsedTitle ?? prev.parsedTitle,
          savedAt: Date.now(),
        }
      : {
          ...entry,
          actual: prev?.actual,
          actualByProfile: prev?.actualByProfile,
          savedAt: Date.now(),
        };
  writeAll(all);
}

export function recordActualPlayback(playback: ActualPlayback): boolean {
  if (!isPlaybackActorCurrent(playback.actor)) return false;
  const safe = persistableActualPlayback(playback);
  if (!safe || !validActualPlayback(safe)) return false;
  playback = safe;
  const all = readAll();
  const key = entryKey(
    playback.src.meta.id,
    playback.src.episode?.season,
    playback.src.episode?.episode,
  );
  const previous = all[key];
  const previousOwn = ownActualState(previous, playback.actor);
  const previousActual = previousOwn.actual;
  // mpv can clear its track list at natural EOF. That is not a new audio
  // choice; keep only the last observed choice from this exact session.
  const sameEndedSession =
    playback.completed &&
    previousActual &&
    validActualPlayback(previousActual) &&
    previousActual.id === playback.id &&
    actualPlaybackSourceKey(previousActual) === actualPlaybackSourceKey(playback);
  const actual = sameEndedSession
    ? {
        ...playback,
        audioTrack: playback.audioTrack ?? previousActual.audioTrack,
        subtitle: playback.subtitle ?? previousActual.subtitle,
        subDelaySec: playback.subDelaySec ?? previousActual.subDelaySec,
        audioDelaySec: playback.audioDelaySec ?? previousActual.audioDelaySec,
      }
    : playback;
  const shared = previous?.actual;
  const updateShared =
    !shared || !samePlaybackOwner(shared, playback.actor) || shared.playedAt <= actual.playedAt;
  const updateOwn = !previousActual || previousActual.playedAt <= actual.playedAt;
  const next = {
    ...all,
    [key]: {
      ...previous,
      title: previous?.title ?? playback.src.meta.name,
      savedAt: Math.max(previous?.savedAt ?? 0, playback.playedAt),
      actual: updateShared ? actual : shared,
      actualByProfile: {
        ...retainedActualProfiles(previous, playback.actor),
        ...(updateOwn
          ? {
              [playback.actor.profileId]: {
                actual,
              },
            }
          : {}),
      },
    },
  };
  const entries = Object.entries(next).sort((a, b) => b[1].savedAt - a[1].savedAt);
  try {
    localStorage.setItem(
      storeKey(),
      JSON.stringify(persistableEntries(Object.fromEntries(entries.slice(0, MAX_ENTRIES)))),
    );
  } catch {
    return false;
  }
  notifyPlayback();
  return true;
}

function validActualPlayback(value: ActualPlayback): boolean {
  const server = value?.src?.homeServer;
  const stream = value?.src?.streamRef;
  const refreshable =
    !!value?.requiresSourceRefresh &&
    (!!value.sourceFingerprint ||
      !!stream?.infoHash ||
      (!!stream?.addonId && !!stream.parsedTitle && !!stream.size && stream.size > 0));
  const serverIdentity =
    !!server &&
    [server.connectionId, server.itemId, server.versionId].every(
      (id) => typeof id === "string" && !!id,
    ) &&
    ["original", "4k-40", "1080p-20", "1080p-12", "720p-4", "480p-2", "360p-0.7"].includes(
      server.quality,
    );
  return (
    !!value &&
    typeof value.id === "string" &&
    !!value.id &&
    typeof value.completed === "boolean" &&
    Number.isFinite(value.playedAt) &&
    Number.isFinite(value.positionMs) &&
    value.positionMs >= 0 &&
    Number.isFinite(value.durationMs) &&
    value.durationMs >= 0 &&
    !!value.actor &&
    typeof value.actor.storageProfileId === "string" &&
    typeof value.src?.url === "string" &&
    (server ? serverIdentity : !!value.src.url || refreshable) &&
    typeof value.src?.meta?.id === "string" &&
    !!value.src.meta.id &&
    typeof value.src.meta.name === "string"
  );
}

function persistableActualPlayback(value: ActualPlayback): ActualPlayback | undefined {
  if (!validActualPlayback(value)) return undefined;
  const src = persistablePlaybackSource(value.src);
  const actor = persistablePlaybackFields(value.actor, [
    "profileId",
    "storageProfileId",
    "accountId",
    "provider",
    "privateCw",
  ]);
  if (
    typeof actor.profileId !== "string" ||
    typeof actor.storageProfileId !== "string" ||
    !(actor.accountId === null || typeof actor.accountId === "string") ||
    (actor.provider !== undefined && actor.provider !== "nuvio")
  )
    return undefined;
  const audio = value.audioTrack
    ? persistablePlaybackFields(value.audioTrack, [
        "id",
        "lang",
        "title",
        "codec",
        "channels",
        "channelCount",
      ])
    : undefined;
  const audioValid =
    audio &&
    typeof audio.id === "string" &&
    (["lang", "title", "codec", "channels"] as const).every(
      (key) => audio[key] === undefined || typeof audio[key] === "string",
    ) &&
    (audio.channelCount === undefined || typeof audio.channelCount === "number");
  return {
    id: persistablePlaybackIdentity(value.id),
    actor,
    playedAt: value.playedAt,
    positionMs: value.positionMs,
    durationMs: value.durationMs,
    completed: value.completed,
    src,
    sourceFingerprint:
      playbackUrlFingerprint(value.src) ??
      (typeof value.sourceFingerprint === "string" && /^[a-f0-9]{64}$/.test(value.sourceFingerprint)
        ? value.sourceFingerprint
        : undefined),
    requiresSourceRefresh:
      value.requiresSourceRefresh === true ||
      !!value.src.proxySessionId ||
      !!Object.keys(value.src.headers ?? {}).length ||
      !!src.streamRef?.infoHash ||
      !!src.homeServer ||
      !src.url ||
      undefined,
    audioTrack: audioValid ? audio : undefined,
    subtitle: persistablePlaybackSubtitle(value.subtitle, value.src),
    subDelaySec: Number.isFinite(value.subDelaySec) ? value.subDelaySec : undefined,
    audioDelaySec: Number.isFinite(value.audioDelaySec) ? value.audioDelaySec : undefined,
  };
}

function persistableEntry(entry: PlaybackEntry, key?: string): PlaybackEntry {
  const preference = persistablePlaybackPreference(entry);
  const metaId = entry.actual?.src?.meta?.id;
  const opaque =
    key?.startsWith("playback-private:") ||
    (!!metaId && persistablePlaybackIdentity(metaId).startsWith("playback-private:"));
  return {
    ...preference,
    ...(opaque ? { title: "Direct stream", parsedTitle: undefined } : {}),
    ...(entry.actual ? { actual: persistableActualPlayback(entry.actual) } : {}),
    ...(entry.actualByProfile
      ? {
          actualByProfile: Object.fromEntries(
            Object.entries(entry.actualByProfile)
              .filter(([, state]) => !!state?.actual)
              .map(([id, state]) => [
                persistablePlaybackIdentity(id),
                {
                  ...(state?.actual ? { actual: persistableActualPlayback(state.actual) } : {}),
                  ...persistablePlaybackFields(
                    state as ActualPlaybackState & { dismissedActualId?: string },
                    ["dismissedActualId"],
                  ),
                },
              ]),
          ),
        }
      : {}),
    // Old versions wrote this inert field. It never controls visibility here.
    ...persistablePlaybackFields(entry as PlaybackEntry & { dismissedActualId?: string }, [
      "dismissedActualId",
    ]),
  };
}

function persistableEntries(entries: Record<string, PlaybackEntry>): Record<string, PlaybackEntry> {
  return Object.fromEntries(
    Object.entries(entries).map(([key, entry]) => [key, persistableEntry(entry, key)]),
  );
}

export function readLastActualPlayback(): ActualPlayback | null {
  const actor = capturePlaybackActor();
  let last: ActualPlaybackState | null = null;
  for (const entry of Object.values(readAll())) {
    const state = selectedActualState(entry, actor);
    const actual = state.actual;
    if (!actual || Date.now() - actual.playedAt > TTL_MS) continue;
    if (!last || actual.playedAt > last.actual!.playedAt) last = state;
  }
  return last?.actual ?? null;
}

export function readActualPlaybackForTarget(
  metaId: string,
  season?: number,
  episode?: number,
): ActualPlayback | null {
  const entry = readAll()[entryKey(metaId, season, episode)]?.actual;
  const actor = capturePlaybackActor();
  return entry &&
    validActualPlayback(entry) &&
    entry.actor.storageProfileId === actor.storageProfileId &&
    entry.actor.accountId === actor.accountId
    ? entry
    : null;
}

export function playbackSourceKey(
  src: Pick<PlayerSrc, "url" | "historyUrl" | "streamRef" | "homeServer">,
): string {
  if (src.homeServer)
    return `server:${src.homeServer.connectionId}:${src.homeServer.itemId}:${src.homeServer.versionId}`;
  if (src.streamRef?.infoHash)
    return `torrent:${src.streamRef.infoHash.toLowerCase()}:${src.streamRef.fileIdx ?? ""}`;
  const url = persistablePlaybackUrl(src.historyUrl ?? src.url);
  if (url) return url;
  const fingerprint = playbackUrlFingerprint(src);
  if (fingerprint) return `private:${fingerprint}`;
  const stream = src.streamRef;
  // Older redacted sources may only have their verified release fields.
  return stream?.addonId && stream.parsedTitle && stream.size && stream.size > 0
    ? `release:${JSON.stringify([stream.addonId, stream.parsedTitle, stream.size, stream.fileIdx ?? null])}`
    : "";
}

export function actualPlaybackSourceKey(playback: ActualPlayback): string {
  return playback.sourceFingerprint
    ? `private:${playback.sourceFingerprint}`
    : playbackSourceKey(playback.src);
}

export function readActualPlaybackFor(src: PlayerSrc): ActualPlayback | null {
  const actor = capturePlaybackActor();
  const entry = selectedActualState(
    readAll()[entryKey(src.meta.id, src.episode?.season, src.episode?.episode)],
    actor,
  ).actual;
  const sourceKey = playbackSourceKey(src);
  return entry && sourceKey && actualPlaybackSourceKey(entry) === sourceKey ? entry : null;
}

/** Capture the observed session before an asynchronous subtitle cache write starts. */
export function readActualPlaybackForSubtitle(
  mediaKey: string,
  streamKey: string | undefined,
  notBefore: number,
): ActualPlayback | null {
  const actor = capturePlaybackActor();
  const parts = /^(.*)\|([^|]*)\|([^|]*)$/.exec(mediaKey);
  if (parts) mediaKey = `${persistablePlaybackIdentity(parts[1])}|${parts[2]}|${parts[3]}`;
  if (streamKey) streamKey = persistablePlaybackIdentity(streamKey);
  return (
    Object.values(readAll())
      .map((entry) => ownActualState(entry, actor).actual)
      .find(
        (actual) =>
          actual &&
          validActualPlayback(actual) &&
          actual.actor.profileId === actor.profileId &&
          actual.actor.storageProfileId === actor.storageProfileId &&
          actual.actor.accountId === actor.accountId &&
          actual.playedAt >= notBefore &&
          subtitleMediaKey(
            actual.src.meta.id,
            actual.src.episode?.season,
            actual.src.episode?.episode,
          ) === mediaKey &&
          (actual.subtitle?.streamKey ?? subtitleStreamKey(actual.src.streamRef)) === streamKey,
      ) ?? null
  );
}

/** Cache completion may improve a source pointer, never playback recency or a newer session. */
export function cacheActualPlaybackSubtitle(
  target: ActualPlayback,
  original: PlaybackSubtitleChoice,
  cached: PlaybackSubtitleChoice,
): boolean {
  if (
    !isPlaybackActorCurrent(target.actor) ||
    !cached.imported ||
    !cached.source ||
    /^(https?|blob|data|memory):/i.test(cached.source)
  )
    return false;
  const all = readAll();
  const key = entryKey(target.src.meta.id, target.src.episode?.season, target.src.episode?.episode);
  const entry = all[key];
  const own = ownActualState(entry, target.actor);
  const actual = own.actual;
  const savedOriginal = persistablePlaybackSubtitle(original, target.src);
  if (
    !entry ||
    !actual ||
    !validActualPlayback(actual) ||
    actual.id !== target.id ||
    actualPlaybackSourceKey(actual) !== actualPlaybackSourceKey(target) ||
    !actual.subtitle ||
    actual.subtitle.off ||
    !(
      (actual.subtitle.source && actual.subtitle.source === savedOriginal?.source) ||
      (actual.subtitle.sourceFingerprint &&
        actual.subtitle.sourceFingerprint === savedOriginal?.sourceFingerprint)
    ) ||
    actual.subtitle.streamKey !== savedOriginal?.streamKey ||
    actual.subtitle.subId !== savedOriginal?.subId ||
    actual.subtitle.provider !== savedOriginal?.provider
  )
    return false;
  const patched = {
    ...actual,
    subtitle: { ...actual.subtitle, ...cached, fpsOverride: actual.subtitle.fpsOverride },
  };
  all[key] = {
    ...entry,
    ...(entry.actual?.id === actual.id ? { actual: patched } : {}),
    actualByProfile: {
      ...entry.actualByProfile,
      [target.actor.profileId]: { ...own, actual: patched },
    },
  };
  try {
    localStorage.setItem(storeKey(), JSON.stringify(persistableEntries(all)));
  } catch {
    return false;
  }
  notifyPlayback();
  return true;
}

export function readPlayback(
  metaId: string,
  season?: number,
  episode?: number,
): PlaybackEntry | null {
  const all = readAll();
  return all[entryKey(metaId, season, episode)] ?? null;
}

export function clearPlayback(metaId: string, season?: number, episode?: number): void {
  const all = readAll();
  const key = entryKey(metaId, season, episode);
  const actual = all[key]?.actual;
  if (actual || all[key]?.actualByProfile)
    all[key] = {
      savedAt: all[key].savedAt,
      title: actual?.src.meta.name ?? all[key].title,
      actual,
      actualByProfile: all[key].actualByProfile,
    };
  else delete all[key];
  writeAll(all);
}

function offeredBy(
  s: { addonId?: string | null; contributors?: Array<{ id: string }> },
  addonId: string,
): boolean {
  return (
    (s.addonId && persistablePlaybackIdentity(s.addonId) === addonId) ||
    s.contributors?.some((c) => persistablePlaybackIdentity(c.id) === addonId) === true
  );
}

/** True when the stream came from the given addon or one of its contributors. */
export function streamOfferedByAddon(
  s: { addonId?: string | null; contributors?: Array<{ id: string }> },
  addonId: string | null | undefined,
): boolean {
  return !!addonId && offeredBy(s, addonId);
}

/**
 * Pick the remembered addon's stream before a same-file stream from another
 * addon. Debrid library copies and aggregator duplicates share the torrent hash,
 * so a plain hash match would otherwise select whichever row came first.
 */
export function findPreferredSourceMatch<
  T extends {
    addonId?: string | null;
    contributors?: Array<{ id: string }>;
    resolution?: string | null;
    releaseGroupNormalized?: string | null;
    audioLanguages?: string[] | null;
  },
>(
  streams: T[],
  entry: PlaybackEntry,
  match: (stream: T, entry: PlaybackEntry) => boolean,
): T | null {
  const candidates = streams.filter((s) => match(s, entry));
  const rememberedLangs = (entry.audioLanguages ?? []).filter((l) => l !== "Multi");
  const score = (s: T): number =>
    (streamOfferedByAddon(s, entry.addonId) ? 4 : 0) +
    (entry.releaseGroup && s.releaseGroupNormalized === entry.releaseGroup ? 2 : 0) +
    (rememberedLangs.some((l) => (s.audioLanguages ?? []).includes(l)) ? 2 : 0) +
    (entry.resolution && s.resolution === entry.resolution ? 1 : 0);
  // Addon first, then the same release group/dub, then the quality the user picked.
  return candidates.slice().sort((a, b) => score(b) - score(a))[0] ?? null;
}

export function streamMatchesEntry(
  s: {
    infoHash?: string | null;
    fileIdx?: number | null;
    url?: string | null;
    addonId?: string | null;
    contributors?: Array<{ id: string }>;
    parsedTitle?: string | null;
    resolution?: string | null;
    source?: string | null;
    size?: number | null;
  },
  e: PlaybackEntry,
): boolean {
  if (e.infoHash && s.infoHash) {
    if (s.infoHash.toLowerCase() !== e.infoHash.toLowerCase()) return false;
    if (e.fileIdx == null || s.fileIdx == null) return true;
    return s.fileIdx === e.fileIdx;
  }
  if (
    e.addonId &&
    offeredBy(s, e.addonId) &&
    e.parsedTitle &&
    s.parsedTitle === e.parsedTitle &&
    e.resolution === s.resolution &&
    e.source === s.source &&
    (e.fileIdx == null || s.fileIdx == null || e.fileIdx === s.fileIdx) &&
    (e.size == null || s.size == null || e.size === s.size)
  ) {
    return true;
  }
  if (e.url && s.url) return s.url === e.url;
  if (e.urlFingerprint && s.url) return playbackUrlFingerprint({ url: s.url }) === e.urlFingerprint;
  return false;
}

export type WatchedSet = { ids: Set<string>; titles: Set<string> };

export function watchTitleKey(name: string | null | undefined): string {
  if (!name) return "";
  return name
    .toLowerCase()
    .replace(/\(\d{4}\)/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

export function recentlyPlayed(): WatchedSet {
  const ids = new Set<string>();
  const titles = new Set<string>();
  for (const [key, entry] of Object.entries(readAll())) {
    const base = key.split("|")[0];
    if (base) ids.add(base);
    const parsed = watchTitleKey(entry.parsedTitle);
    if (parsed) titles.add(parsed);
    const raw = watchTitleKey(entry.title);
    if (raw) titles.add(raw);
  }
  return { ids, titles };
}

export function useWatchedCount(): number {
  return useSyncExternalStore(
    subscribePlayback,
    () => recentlyPlayed().ids.size,
    () => 0,
  );
}

export function playbackEntries(): Array<{
  metaId: string;
  savedAt: number;
  title?: string;
  parsedTitle?: string;
}> {
  const out: Array<{ metaId: string; savedAt: number; title?: string; parsedTitle?: string }> = [];
  for (const [key, entry] of Object.entries(readAll())) {
    const metaId = key.split("|")[0];
    if (!metaId || typeof entry.savedAt !== "number") continue;
    out.push({
      metaId,
      savedAt: entry.savedAt,
      title: entry.title ?? undefined,
      parsedTitle: entry.parsedTitle ?? undefined,
    });
  }
  return out;
}

export function readLastSeriesPlayback(metaId: string): PlaybackEntry | null {
  metaId = persistablePlaybackIdentity(metaId);
  const all = readAll();
  const prefix = `${metaId}|`;
  let best: PlaybackEntry | null = null;
  for (const [key, entry] of Object.entries(all)) {
    if (key !== metaId && !key.startsWith(prefix)) continue;
    if (!best || entry.savedAt > best.savedAt) best = entry;
  }
  return best;
}

export function streamMatchesSource(
  s: {
    infoHash?: string | null;
    addonId?: string | null;
    contributors?: Array<{ id: string }>;
    resolution?: string | null;
    source?: string | null;
    behaviorHints?: { bingeGroup?: string };
  },
  e: PlaybackEntry,
): boolean {
  if (e.infoHash && s.infoHash) {
    return s.infoHash.toLowerCase() === e.infoHash.toLowerCase();
  }
  const sBinge = s.behaviorHints?.bingeGroup ?? null;
  if (e.bingeGroup && sBinge) return sBinge === e.bingeGroup;
  return (
    !!e.addonId && offeredBy(s, e.addonId) && e.resolution === s.resolution && e.source === s.source
  );
}

export function streamMatchesReleaseLineage(
  s: {
    infoHash?: string | null;
    addonId?: string | null;
    contributors?: Array<{ id: string }>;
    resolution?: string | null;
    source?: string | null;
    releaseGroupNormalized?: string | null;
    behaviorHints?: { bingeGroup?: string };
  },
  e: PlaybackEntry,
): boolean {
  if (streamMatchesSource(s, e)) return true;
  if (!e.releaseGroup || !s.releaseGroupNormalized) return false;
  if (s.releaseGroupNormalized !== e.releaseGroup) return false;
  if (e.addonId && !offeredBy(s, e.addonId)) return false;
  return e.resolution === s.resolution && e.source === s.source;
}

/** A confirmed next-episode release match, not an addon/quality fallback. */
export function streamMatchesPreferredSource(
  s: Parameters<typeof streamMatchesReleaseLineage>[0] & {
    audioLanguages?: string[] | null;
  },
  e: PlaybackEntry,
): boolean {
  if (e.resolution && s.resolution && e.resolution !== s.resolution) return false;
  const rememberedLangs = (e.audioLanguages ?? []).filter((l) => l !== "Multi");
  const candidateLangs = (s.audioLanguages ?? []).filter((l) => l !== "Multi");
  if (
    rememberedLangs.length > 0 &&
    candidateLangs.length > 0 &&
    !rememberedLangs.some((l) => candidateLangs.includes(l))
  )
    return false;
  if (e.infoHash && s.infoHash && e.infoHash.toLowerCase() === s.infoHash.toLowerCase())
    return true;
  if (e.bingeGroup && s.behaviorHints?.bingeGroup === e.bingeGroup) return true;
  // Aggregators share one addon ID across unrelated releases. Only the release
  // identity can confirm a match; generic quality fallback is handled by the picker.
  return (
    !!e.releaseGroup && !!s.releaseGroupNormalized && e.releaseGroup === s.releaseGroupNormalized
  );
}

export function streamMatchesPreferredSourceFallback(
  s: Parameters<typeof streamMatchesReleaseLineage>[0] & {
    audioLanguages?: string[] | null;
  },
  e: PlaybackEntry,
): boolean {
  if (streamMatchesPreferredSource(s, e)) return true;
  if (!e.addonId || !offeredBy(s, e.addonId)) return false;
  // A dub is part of the source identity. Only reject when both sides name a
  // concrete language and they have none in common; an unlabelled release must
  // remain eligible.
  const rememberedLangs = (e.audioLanguages ?? []).filter((l) => l !== "Multi");
  const candidateLangs = (s.audioLanguages ?? []).filter((l) => l !== "Multi");
  if (
    rememberedLangs.length > 0 &&
    candidateLangs.length > 0 &&
    !rememberedLangs.some((l) => candidateLangs.includes(l))
  ) {
    return false;
  }
  // The user asked to keep the quality they picked. A same-group 4K episode is
  // not a match for a remembered 1080p source; let the picker choose another
  // 1080p stream instead.
  if (e.resolution && s.resolution && e.resolution !== s.resolution) return false;
  // The same release group is the strongest identity. Source tags often differ
  // between episodes (1080p AV1 vs 1080p WEB-DL), so do not reject a same-group
  // episode merely because its filename carries different tags.
  if (e.releaseGroup && s.releaseGroupNormalized) {
    return e.releaseGroup === s.releaseGroupNormalized;
  }
  if (e.source && s.source && e.source !== s.source) return false;
  return true;
}

export function preferredSourceAddonPending(
  entry: PlaybackEntry | null,
  sourceMatched: boolean,
  pipelineDone: boolean,
  progress: AddonProgress,
): boolean {
  const addonId = entry?.addonId;
  if (!addonId || sourceMatched || pipelineDone) return false;
  if (!progress.queriedAddonIds.includes(addonId)) return false;
  return !progress.settledAddonIds.includes(addonId);
}
