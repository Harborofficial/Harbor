import { useEffect, useRef, useState, type RefObject } from "react";
import type { PlayerBridge } from "@/lib/player/bridge";
import { t } from "@/lib/i18n";
import { writePlayerPrefs } from "@/lib/player-prefs";
import { markImportedSub } from "@/lib/player/imported-subs";
import { writeRememberedSub } from "@/lib/subtitles/subtitle-memory";
import { useSettings } from "@/lib/settings";
import {
  scanLocalSubtitles,
  findMatchingSubtitle,
} from "@/lib/subtitles/local-subtitle-scanner";

const SUB_EXT = /\.(srt|ass|ssa|vtt|sub)$/i;

type EpisodeInfo = {
  title: string;
  alternateTitles?: string[];
  season?: number;
  episode?: number;
};

export function useSubDrop(
  bridgeRef: RefObject<PlayerBridge | null>,
  metaId: string,
  mediaKey: string,
  episodeInfo: EpisodeInfo,
  firstFrameReady: boolean,
) {
  const { settings } = useSettings();
  const localSubtitleFolder = settings.localSubtitleFolder;
  const alternateTitlesKey = JSON.stringify(
    episodeInfo.alternateTitles ?? [],
  );

  const [toast, setToast] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

    useEffect(() => {
    if (!localSubtitleFolder || !firstFrameReady) return;

    let cancelled = false;

    void (async () => {
      try {
        const files = await scanLocalSubtitles(localSubtitleFolder);

        if (cancelled) return;

        const match = findMatchingSubtitle(files, episodeInfo);
        if (!match) return;

        const bridge = bridgeRef.current;
        if (!bridge) return;

        const fileName = match.split(/[\\/]/).pop() ?? "Local Subtitle";
        const subtitleTitle = fileName.replace(
          /\.(ass|srt|ssa|vtt|sub)$/i,
          "",
        );

        const loaded = await bridge.addSubtitle(
          match,
          undefined,
          subtitleTitle,
          true,
          undefined,
          "automatic",
        );

        if (cancelled) return;

        if (!loaded) {
          console.warn("[Local Subtitles] Failed to load:", match);
        }
      } catch (error) {
        if (!cancelled) {
          console.error("[Local Subtitles] Scan failed:", error);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    bridgeRef,
    localSubtitleFolder,
    alternateTitlesKey,
    episodeInfo.title,
    episodeInfo.season,
    episodeInfo.episode,
    mediaKey,
    firstFrameReady,
  ]);

  useEffect(() => {
    if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return;

    let cancelled = false;
    let un: (() => void) | null = null;
    void (async () => {
      try {
        const { getCurrentWebview } = await import("@tauri-apps/api/webview");
        const unlisten = await getCurrentWebview().onDragDropEvent((e) => {
          if (e.payload.type !== "drop") return;
          const path = e.payload.paths.find((p) => SUB_EXT.test(p));
          if (!path) return;
          const name = path.split(/[\\/]/).pop() ?? "Subtitle";
          const title = name.replace(SUB_EXT, "");
          void bridgeRef.current?.addSubtitle(path, undefined, title, true).then((ok) => {
            if (ok) {
              writePlayerPrefs(metaId, { subsOff: false });
              markImportedSub(title);
              writeRememberedSub(mediaKey, { source: path, title, imported: true });
            }
            setToast(ok ? t("Loaded {name}", { name }) : t("Couldn't load {name}", { name }));
            if (timer.current) window.clearTimeout(timer.current);
            timer.current = window.setTimeout(() => setToast(null), 2200);
          });
        });
        if (cancelled) {
          unlisten();
        } else {
          un = unlisten;
        }
      } catch {}
    })();
    return () => {
      cancelled = true;
      un?.();
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [bridgeRef, metaId, mediaKey]);

  return toast;
}
