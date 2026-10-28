import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { message } from "@tauri-apps/plugin-dialog";
import { t } from "@/lib/i18n";
import { isLinuxDesktop, isMacDesktop, isWindowsDesktop } from "@/lib/platform";
import type { Settings } from "@/lib/settings";
import { takePreparedSubtitle } from "@/lib/subtitles/prepared-registry";
import { isSafeProviderSubtitleUrl } from "@/lib/subtitles/provider-url";
import { subtitleSourceIsLocal } from "@/lib/subtitles/subtitle-memory";
import { makeSafeTauriUnlisten } from "@/lib/tauri-unlisten";
import {
  initialPlayerSnapshot,
  type PlayerBridge,
  type PlayerCapabilities,
  type PlayerSnapshot,
  type PlayerSource,
} from "./bridge";
import { PreparedSubtitleCleanupRegistry } from "./prepared-subtitle-cleanups";

/** This tells Harbor when mpv has closed, so it leaves the player screen. */
export const EXTERNAL_PLAYER_CLOSED_EVENT = "harbor:external-player-closed";

/** How much time in "ms" Harbor has to start the next episode or go back to the title screen after mpv finishes. */
const LEAVE_AFTER_END_MS = 2000;

/** If mpv closes within the last 3 seconds of the playback, it counts as finished. */
const END_SLACK_SEC = 3;

export type ExternalMpvOptions = {
  /** Path to the mpv executable. If left empty then it uses mpv from PATH. */
  binary: string;
  /** Extra command line options for mpv. */
  args: string;
  title: string;
};

type ExternalPlayerState = {
  session: number;
  positionSec: number;
  durationSec: number;
  paused: boolean;
  buffering: boolean;
  loaded: boolean;
  eof: boolean;
  width: number;
  height: number;
  error: string | null;
  launchError: string | null;
};

/** Whether videos play in the user's own mpv. Harbor can only start it on desktop. */
export function externalMpvEnabled(settings: Pick<Settings, "playerExternalMpv">): boolean {
  return settings.playerExternalMpv && (isWindowsDesktop() || isMacDesktop() || isLinuxDesktop());
}

/** Cuts the mpv options text into separate options at each space, but it keeps text inside quotes together. */
export function splitArgs(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  let started = false;
  for (const ch of line) {
    if (ch === '"') {
      quoted = !quoted;
      started = true;
    } else if (/\s/.test(ch) && !quoted) {
      if (started) out.push(cur);
      cur = "";
      started = false;
    } else {
      cur += ch;
      started = true;
    }
  }
  if (started) out.push(cur);
  return out;
}

/**
 * Puts where a subtitle came from in front of its name, like "[SubMaker] Show S01E01", so mpv's
 * subtitle list shows it. With a provider the dots become spaces, because mpv menus like uosc
 * treat a name with dots as a file name and cut parts of it off.
 */
export function mpvSubtitleTitle(name?: string, provider?: string): string | undefined {
  const from = provider?.trim();
  if (!from) return name;
  const title = name?.trim();
  const labelled =
    title && !title.toLowerCase().startsWith(from.toLowerCase())
      ? `[${from}] ${title}`
      : title || from;
  return labelled.replace(/\./g, " ").replace(/\s+/g, " ").trim();
}

/**
 * The bridge for the user's external mpv. Harbor's player screen will stay open in the
 * background, so resume, Stremio sync, watched marking and next episode all keep working.
 */
export function createExternalMpvBridge(opts: ExternalMpvOptions): PlayerBridge {
  let snap: PlayerSnapshot = initialPlayerSnapshot();
  const listeners = new Set<(s: PlayerSnapshot) => void>();
  let host: HTMLElement | null = null;
  let notice: HTMLElement | null = null;
  let session = 0;
  let starting = false;
  // mpv can send updates before we get our ticket number, so we keep them here until it arrives.
  let early: Array<{ exit: boolean; s: ExternalPlayerState }> = [];
  let loadId = 0;
  let destroyed = false;
  let mediaTitle = opts.title;
  let pendingSubs: Array<{ url: string; lang?: string; title?: string }> = [];
  // Subtitle files that Harbor made on this computer. They stay until mpv no longer needs them.
  const preparedSubs = new PreparedSubtitleCleanupRegistry();
  // What mpv already got for this video, by file content and by link. Two sources can serve the
  // very same subtitle (SubMaker also finds OpenSubtitles files), and mpv only needs one copy.
  let seenSubs = new Set<string>();
  // How often each track name was used for this video. Different subtitles often get the same
  // name (same provider and release), so later ones become "#2", "#3" in mpv's list.
  let titleUses = new Map<string, number>();
  let unlisten: Array<() => void> = [];

  const numberedTitle = (name?: string) => {
    if (!name) return name;
    const uses = (titleUses.get(name) ?? 0) + 1;
    titleUses.set(name, uses);
    return uses > 1 ? `${name} #${uses}` : name;
  };

  const emit = () => {
    const next: PlayerSnapshot = { ...snap };
    listeners.forEach((l) => l(next));
  };

  const command = (cmd: unknown[]) =>
    session
      ? invoke("external_player_command", { session, cmd })
      : Promise.reject(new Error("external mpv is not running"));

  const flushSubs = () => {
    const subs = pendingSubs;
    pendingSubs = [];
    // "auto" adds Harbor's subtitles to mpv's list without switching to them, so the user's own subtitle choice stays.
    for (const s of subs) {
      void command(["sub-add", s.url, "auto", s.title ?? s.lang ?? "", s.lang ?? ""]).catch(
        () => {},
      );
    }
  };

  const onState = (s: ExternalPlayerState) => {
    if (starting) early.push({ exit: false, s });
    if (s.session !== session) return;
    const wasLoaded = snap.firstFrameReady;
    if (s.error) {
      snap.status = "error";
      snap.errorCode = "source";
      snap.errorMessage = s.error;
    } else if (s.eof) {
      snap.status = "ended";
      if (s.durationSec > 0) s.positionSec = s.durationSec;
    } else if (!s.loaded) {
      snap.status = "loading";
    } else {
      snap.status = s.paused ? "paused" : "playing";
    }
    snap.positionSec = s.positionSec;
    snap.durationSec = s.durationSec;
    snap.buffering = s.buffering;
    snap.firstFrameReady = s.loaded;
    snap.videoWidth = s.width;
    snap.videoHeight = s.height;
    snap.videoSourceWidth = s.width;
    snap.videoSourceHeight = s.height;
    emit();
    if (s.loaded && !wasLoaded) {
      flushSubs();
      if (mediaTitle)
        void command(["set_property", "force-media-title", mediaTitle]).catch(() => {});
    }
  };

  /** When mpv can't start, show the real reason instead of blaming the video source. */
  const failLaunch = (detail: string) => {
    session = 0;
    snap.status = "paused";
    emit();
    void message(detail, { title: t("mpv could not start"), kind: "error" }).catch(() => {});
    window.dispatchEvent(new Event(EXTERNAL_PLAYER_CLOSED_EVENT));
  };

  const onExit = (s: ExternalPlayerState) => {
    if (starting) early.push({ exit: true, s });
    if (s.session !== session) return;
    if (s.launchError) {
      failLaunch(s.launchError);
      return;
    }
    if (snap.status !== "ended") onState(s);
    session = 0;
    if (snap.status === "error") return;
    if (snap.status !== "ended") {
      // mpv reports a real end before it quits. Closing it during the credits is the
      // viewer leaving, that will not start the next episode.
      const atEnd = snap.durationSec > 0 && snap.durationSec - snap.positionSec <= END_SLACK_SEC;
      if (!atEnd) {
        snap.status = "paused";
        emit();
        window.dispatchEvent(new Event(EXTERNAL_PLAYER_CLOSED_EVENT));
        return;
      }
      snap = { ...snap, status: "ended" };
      emit();
    }
    // With mpv gone the player view has nothing left to show. Harbor normally starts the
    // next episode or leaves by itself, but it stays when playback began near the end.
    const finishedLoad = loadId;
    window.setTimeout(() => {
      if (!destroyed && loadId === finishedLoad && session === 0) {
        window.dispatchEvent(new Event(EXTERNAL_PLAYER_CLOSED_EVENT));
      }
    }, LEAVE_AFTER_END_MS);
  };

  const ensureListening = async () => {
    if (unlisten.length) return;
    unlisten = [
      makeSafeTauriUnlisten(
        await listen<ExternalPlayerState>("external-player://state", (e) => onState(e.payload)),
      ),
      makeSafeTauriUnlisten(
        await listen<ExternalPlayerState>("external-player://exit", (e) => onExit(e.payload)),
      ),
    ];
    if (destroyed) unlisten.forEach((u) => u());
  };

  const renderNotice = () => {
    if (!host || notice) return;
    notice = document.createElement("div");
    notice.className =
      "absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black px-6 text-center text-white/80";
    const title = document.createElement("p");
    title.className = "text-[20px] font-semibold";
    title.textContent = t("Playing in your mpv");
    const sub = document.createElement("p");
    sub.className = "max-w-[48ch] text-[15px] text-white/60";
    sub.textContent = t(
      "Harbor keeps your progress in sync while it plays. Close mpv to come back here.",
    );
    notice.append(title, sub);
    host.appendChild(notice);
  };

  return {
    attach(h) {
      host = h;
      renderNotice();
    },
    detach() {
      notice?.remove();
      notice = null;
      host = null;
    },
    async load(src: PlayerSource) {
      const myLoad = ++loadId;
      mediaTitle = src.title ?? mediaTitle;
      session = 0;
      pendingSubs = [];
      seenSubs = new Set();
      titleUses = new Map();
      for (const s of src.subtitles ?? []) {
        // Like Harbor's own players, an addon's link must be public unless the addon runs locally.
        if (!/^https?:\/\//i.test(s.url)) continue;
        if (s.trustedSource !== true && !isSafeProviderSubtitleUrl(s.url)) continue;
        // A stream can list the same subtitle twice, and mpv only needs it once.
        if (seenSubs.has(`url:${s.url}`)) continue;
        seenSubs.add(`url:${s.url}`);
        pendingSubs.push({ url: s.url, lang: s.lang });
      }
      snap = {
        ...snap,
        status: "loading",
        positionSec: 0,
        durationSec: 0,
        bufferedSec: 0,
        buffering: false,
        firstFrameReady: false,
        videoWidth: 0,
        videoHeight: 0,
        videoSourceWidth: 0,
        videoSourceHeight: 0,
        errorCode: null,
        errorMessage: null,
      };
      emit();
      try {
        await ensureListening();
        starting = true;
        early = [];
        const id = await invoke<number>("external_player_start", {
          args: {
            url: src.url,
            binary: opts.binary,
            startAtSec: src.startAtSec ?? null,
            startPaused: src.startPaused === true,
            title: mediaTitle,
            headers: src.headers ?? null,
            extraArgs: splitArgs(opts.args),
          },
        });
        if (destroyed || myLoad !== loadId) {
          void invoke("external_player_stop", { session: id }).catch(() => {});
          return;
        }
        // Starting this mpv closed the old one, so the subtitle files made for it can go.
        preparedSubs.clearBefore(myLoad);
        session = id;
        starting = false;
        const replay = early.filter((e) => e.s.session === id);
        early = [];
        for (const e of replay) {
          if (e.exit) onExit(e.s);
          else onState(e.s);
        }
      } catch (e) {
        starting = false;
        early = [];
        if (myLoad !== loadId) return;
        failLaunch(e instanceof Error ? e.message : String(e));
      }
    },
    async play() {
      await command(["set_property", "pause", false]).catch(() => {});
    },
    pause() {
      void command(["set_property", "pause", true]).catch(() => {});
    },
    seek(sec) {
      void command(["seek", sec, "absolute"]).catch(() => {});
    },
    // Harbor doesn't change volume, tracks or picture, because the user's own mpv
    // settings and keys control them.
    setVolume() {},
    setMuted() {},
    setRate() {},
    setAudioTrack() {},
    setSubtitleTrack() {},
    setSecondarySubtitleTrack() {},
    setSubVisible() {},
    setSubDelay() {},
    setAudioDelay() {},
    setPanscan() {},
    setVideoZoom() {},
    setAspectOverride() {},
    setStretch() {},
    setVideoEq() {},
    setAnime4kShaders() {},
    async addSubtitle(url, lang, title, _select, metadata) {
      // Harbor saves its best subtitles as files on this computer. Taking one here means this
      // bridge deletes it later.
      const prepared = takePreparedSubtitle(url);
      // The same rule as Harbor's own players: a subtitle from a provider needs a public web link.
      const providerDerived = metadata?.providerDerived ?? Boolean(metadata?.provider);
      const allowed =
        !destroyed &&
        // mpv can open web links and files, but not blob: and data: links from inside Harbor.
        (/^https?:\/\//i.test(url) || subtitleSourceIsLocal(url)) &&
        (prepared != null || !providerDerived || isSafeProviderSubtitleUrl(url));
      if (!allowed) {
        prepared?.cleanup();
        return false;
      }
      const keys = [
        prepared ? `text:${prepared.text.replace(/\r\n?/g, "\n").trim()}` : `url:${url}`,
        ...(metadata?.originalUrl ? [`url:${metadata.originalUrl}`] : []),
      ];
      if (keys.some((key) => seenSubs.has(key))) {
        // mpv already has this subtitle, so the copy's file isn't needed.
        prepared?.cleanup();
        return true;
      }
      keys.forEach((key) => seenSubs.add(key));
      if (prepared) preparedSubs.register(prepared.cleanup, loadId);
      pendingSubs.push({
        url,
        lang,
        title: numberedTitle(mpvSubtitleTitle(title ?? lang, metadata?.provider)),
      });
      if (snap.firstFrameReady) flushSubs();
      return true;
    },
    getSelectedTrackCues: () => null,
    getSelectedTrackUrl: () => null,
    setAudioNormalize() {},
    setMediaInfo(info) {
      mediaTitle = info.title;
      if (snap.firstFrameReady) {
        void command(["set_property", "force-media-title", mediaTitle]).catch(() => {});
      }
    },
    async screenshot() {
      return { ok: false, error: "Take screenshots from your mpv window." };
    },
    setAbLoop() {},
    async requestPiP() {},
    async exitPiP() {},
    async requestFullscreen() {},
    async exitFullscreen() {},
    capabilities(): PlayerCapabilities {
      return {
        engine: "html5",
        external: true,
        pictureInPicture: false,
        airplay: false,
        chromecast: false,
        hdrPassthrough: false,
        hardwareDecode: true,
      };
    },
    subscribe(l) {
      listeners.add(l);
      l({ ...snap });
      return () => {
        listeners.delete(l);
      };
    },
    destroy() {
      // Only close our own mpv, because a newer player may have started a new one. If mpv
      // is still starting we don't have its ticket number yet, so load closes it once the
      // number arrives.
      const running = session;
      destroyed = true;
      loadId += 1;
      session = 0;
      listeners.clear();
      unlisten.forEach((u) => u());
      unlisten = [];
      preparedSubs.clearAll();
      notice?.remove();
      notice = null;
      host = null;
      if (running) void invoke("external_player_stop", { session: running }).catch(() => {});
    },
  };
}
