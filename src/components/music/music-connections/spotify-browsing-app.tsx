import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, LoaderCircle } from "@/components/icons/music-icons";
import { emitListToast } from "@/components/lists/list-toast";
import { useT } from "@/lib/i18n";
import { connectSpotifyBrowsing, spotifySetupErrorKey } from "@/lib/music/spotify-setup";
import { getSpotifyStatus } from "@/lib/music/sources";
import type { SpotifyStatus } from "@/lib/music/types";
import { guardMusicSource } from "@/lib/music/source-consent";
import { SpotifyBrowsingGuide } from "./spotify-setup";

/**
 * Independent, optional Web API authorization. Neither successful OAuth nor an old browser
 * token must be reported as proof that the separate librespot audio session can play.
 */
export function SpotifyBrowsingApp({ onDone }: { onDone: () => void }) {
  const t = useT();
  const [clientId, setClientId] = useState("");
  const [status, setStatus] = useState<SpotifyStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const request = useRef(0);

  useEffect(() => {
    let mounted = true;
    const id = ++request.current;
    void getSpotifyStatus()
      .then((next) => {
        if (mounted && request.current === id) setStatus(next);
      })
      .catch((reason) => {
        if (mounted && request.current === id)
          setFailure(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (mounted && request.current === id) setChecking(false);
      });
    return () => {
      mounted = false;
      request.current++;
    };
  }, []);

  const connect = (id?: string) => {
    if (!guardMusicSource("spotify", () => connect(id))) return;
    const attempt = ++request.current;
    setChecking(false);
    setBusy(true);
    setFailure(null);
    void connectSpotifyBrowsing(id)
      .then((next) => {
        if (request.current !== attempt) return;
        setStatus(next);
        if (!next.ownAppBrowsing)
          throw new Error(t("Spotify browsing authorization could not be confirmed. Try again."));
        emitListToast(t("Spotify browsing authorized. Playback uses device pairing separately."));
        onDone();
      })
      .catch((reason) => {
        if (request.current !== attempt) return;
        const message = reason instanceof Error ? reason.message : String(reason);
        const localized = spotifySetupErrorKey(message);
        setFailure(localized ? t(localized) : message);
      })
      .finally(() => {
        if (request.current === attempt) setBusy(false);
      });
  };

  const browsingState = status?.ownAppBrowsing
    ? "music.spotify.browsingOwnApp"
    : status?.browsingReady
      ? "music.spotify.browsingShared"
      : "music.spotify.browsingNotConnected";

  return (
    <details className="group border-t border-edge-soft px-5 py-4">
      <summary className="flex cursor-pointer list-none items-start justify-between gap-4 rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
        <span className="min-w-0">
          <span className="flex flex-wrap items-center gap-2 text-[13px] font-semibold text-ink">
            {t("music.spotifySetup.pairManual")}
            <span className="rounded-full bg-elevated px-2 py-0.5 text-[10px] font-medium text-ink-muted">
              {t("music.spotifySetup.browseOptional")}
            </span>
          </span>
          <span className="mt-1 block text-[12px] leading-5 text-ink-muted">
            {t("music.spotifySetup.browseBody")}
          </span>
          <span
            role="status"
            aria-live="polite"
            className={`mt-2 flex items-center gap-2 text-[12px] font-medium ${status?.ownAppBrowsing ? "text-accent" : "text-ink-muted"}`}
          >
            {status?.ownAppBrowsing && !busy && <Check size={14} aria-hidden="true" />}
            {t("music.spotify.browsingLabel")}:{" "}
            {busy
              ? t("music.connect.connecting")
              : checking
                ? t("Checking connection…")
                : failure && !status
                  ? t("Could not check connection")
                  : t(browsingState)}
          </span>
        </span>
        <ChevronDown
          size={17}
          aria-hidden="true"
          className="mt-1 shrink-0 text-ink-muted transition-transform duration-200 group-open:rotate-180"
        />
      </summary>
      <div className="max-w-2xl pt-3">
        <SpotifyBrowsingGuide clientId={clientId} onChange={setClientId} disabled={busy} />
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={busy || !clientId.trim()}
            onClick={() => connect(clientId.trim())}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-ink px-5 text-[12px] font-semibold text-canvas disabled:opacity-40"
          >
            {busy && <LoaderCircle size={16} className="animate-spin" aria-hidden="true" />}
            {busy ? t("music.connect.connecting") : t("music.spotifySetup.authorize")}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => connect()}
            className="inline-flex h-11 items-center rounded-full border border-edge px-4 text-[12px] font-medium text-ink hover:bg-elevated disabled:opacity-40"
          >
            {t("music.spotifySetup.saved")}
          </button>
        </div>
        <p className="mt-2 text-[12px] leading-5 text-ink-muted">
          {t("music.spotifySetup.savedHint")}
        </p>
        {failure && (
          <p role="alert" className="mt-2 text-[13px] leading-5 text-danger">
            {failure}
          </p>
        )}
      </div>
    </details>
  );
}
