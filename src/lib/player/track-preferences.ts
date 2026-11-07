import type { PlayerSrc } from "@/lib/view";
import type { Settings } from "@/lib/settings";
import type { PlayerSource, TrackInfo } from "./bridge";
import { readPlayerPrefs, type PerShowPrefs } from "@/lib/player-prefs";
import { langScore, normalizeLang, pickBestTrack } from "@/lib/subtitles/language";
import {
  isAutoSelectableSubtitleTrack,
  pickDesiredSubtitleTrack,
} from "@/lib/subtitles/track-selection";
import {
  readRememberedSub,
  rememberedSubAppliesToStream,
  subtitleMediaKey,
  type RememberedSub,
} from "@/lib/subtitles/subtitle-memory";
import { playbackSourceKey, readActualPlaybackFor } from "@/lib/playback-history";
import { selectPlaybackAudio } from "./audio-choice";
import { expandOriginalAudioLang } from "./audio-language";

function blockWords(s: Settings): string[] {
  return (s.trackBlockWords ?? []).map((w) => w.trim().toLowerCase()).filter(Boolean);
}

function trackMatchesWords(t: { title?: string; label?: string }, words: string[]): boolean {
  const hay = `${t.title ?? ""} ${t.label ?? ""}`.toLowerCase();
  return words.some((w) => hay.includes(w));
}

function isForcedTrack(t: { title?: string; label?: string }): boolean {
  return /\bforced\b/i.test(`${t.title ?? ""} ${t.label ?? ""}`);
}

export function subsOffFor(prefs: PerShowPrefs | null, s: Settings): boolean {
  if (prefs?.subsOff != null) return prefs.subsOff;
  if (s.subtitlesOffByDefault) return true;
  if (prefs?.subLang) return false;
  return false;
}

export function resolveLangPreference(
  primary: string[] | undefined,
  fallback: string[] | undefined,
): string[] {
  if (primary && primary.length > 0) return primary;
  if (fallback && fallback.length > 0) return fallback;
  return ["English"];
}

export function isJapanese(lang: string): boolean {
  const l = lang.trim().toLowerCase();
  return l === "ja" || l === "jpn" || l === "jp" || l === "japanese";
}

export function trackPreferences(src: PlayerSrc, settings: Settings, prefs: PerShowPrefs | null) {
  const isAnime =
    !!src.meta.id?.startsWith("kitsu:") ||
    !!src.meta.id?.startsWith("mal:") ||
    (src.meta.genres ?? []).some((g) => g.toLowerCase() === "anime");
  const stripJaForNonAnime = (langs: string[]) => {
    if (isAnime) return langs;
    const kept = langs.filter((l) => !isJapanese(l));
    return kept.length > 0 ? kept : langs;
  };
  const resolvedAudio = stripJaForNonAnime(
    resolveLangPreference(settings.preferredAudioLangs, settings.preferredLanguages),
  );
  const expandedAudio = expandOriginalAudioLang(resolvedAudio, src.meta.originalLanguage, isAnime);
  // An unknown original language must not leave the list empty; the locale preference is
  // still a better answer than picking whichever track the release happens to list first.
  const baseAudio =
    expandedAudio.length > 0
      ? expandedAudio
      : stripJaForNonAnime(resolveLangPreference(undefined, settings.preferredLanguages));
  const baseSub = stripJaForNonAnime(
    resolveLangPreference(settings.preferredSubLangs, settings.preferredLanguages),
  );
  const audioLangs = prefs?.audioLang
    ? [prefs.audioLang, ...baseAudio.filter((l) => l !== prefs.audioLang)]
    : baseAudio;
  const subLangs = prefs?.subLang
    ? [prefs.subLang, ...baseSub.filter((l) => l !== prefs.subLang)]
    : baseSub;

  const allow = <T extends { title?: string; label?: string }>(tracks: T[]): T[] => {
    const words = blockWords(settings);
    if (words.length === 0) return tracks;
    const kept = tracks.filter((t) => !trackMatchesWords(t, words));
    return kept.length > 0 ? kept : tracks;
  };
  return { audioLangs, subLangs, allow };
}

export function pickRememberedEmbedded(
  tracks: TrackInfo[],
  remembered: RememberedSub,
): TrackInfo | undefined {
  const sameLang = (a?: string, b?: string) => normalizeLang(a ?? "") === normalizeLang(b ?? "");
  return (
    (remembered.trackId
      ? tracks.find(
          (t) => !t.external && t.id === remembered.trackId && sameLang(t.lang, remembered.lang),
        )
      : undefined) ??
    tracks.find(
      (t) =>
        !t.external &&
        sameLang(t.lang, remembered.lang) &&
        (!remembered.title || t.title === remembered.title),
    ) ??
    tracks.find((t) => !t.external && sameLang(t.lang, remembered.lang))
  );
}

export function pickAutomaticSubtitle(
  tracks: TrackInfo[],
  audio: TrackInfo | null,
  langs: string[],
  settings: Settings,
  allow: (tracks: TrackInfo[]) => TrackInfo[],
) {
  const nativeAudio =
    settings.forcedSubsWhenNativeAudio && audio != null && langScore(audio.lang ?? "", langs) >= 0;
  return nativeAudio
    ? (tracks
        .filter((t) => isForcedTrack(t) && isAutoSelectableSubtitleTrack(t))
        .sort((a, b) => langScore(b.lang ?? "", langs) - langScore(a.lang ?? "", langs))[0] ?? null)
    : pickDesiredSubtitleTrack(allow(tracks), langs, settings.preferEmbeddedSubs);
}

export function initialTrackSelector(
  src: PlayerSrc,
  settings: Settings,
): NonNullable<PlayerSource["selectInitialTracks"]> {
  return (audio, subtitles) => {
    const prefs = readPlayerPrefs(src.meta.id);
    const { audioLangs, subLangs, allow } = trackPreferences(src, settings, prefs);
    const sourceKey = playbackSourceKey(src);
    const rememberedAudio =
      src.continuation?.sourceKey === sourceKey
        ? src.continuation.audioTrack
        : readActualPlaybackFor(src)?.audioTrack;
    const selectedAudio =
      selectPlaybackAudio(audio, rememberedAudio) ?? pickBestTrack(allow(audio), audioLangs);
    const choice: ReturnType<NonNullable<PlayerSource["selectInitialTracks"]>> = {
      audioId: selectedAudio?.id,
    };
    const remembered = readRememberedSub(
      subtitleMediaKey(src.meta.id, src.episode?.season, src.episode?.episode),
    );
    if (src.subtitlePreselect?.off || subsOffFor(prefs, settings)) choice.subtitleId = null;
    else if (src.subtitlePreselect) choice.subtitleId = null;
    else if (remembered && rememberedSubAppliesToStream(remembered, src.streamRef)) {
      choice.subtitleId =
        remembered.off || remembered.source
          ? null
          : pickRememberedEmbedded(subtitles, remembered)?.id;
    } else {
      choice.subtitleId =
        pickAutomaticSubtitle(subtitles, selectedAudio ?? null, subLangs, settings, allow)?.id ??
        null;
    }
    return choice;
  };
}
