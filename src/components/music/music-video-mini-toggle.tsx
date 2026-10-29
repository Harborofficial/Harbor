import { useT } from "@/lib/i18n";
import { setMusicVideoMiniEnabled, useMusicVideoMini } from "@/lib/music/video-mini";
import "./music-video-mini-toggle.css";

export function MusicVideoMiniToggle({ className = "" }: { className?: string }) {
  const t = useT();
  const mini = useMusicVideoMini();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={mini.enabled}
      onClick={() => setMusicVideoMiniEnabled(!mini.enabled)}
      className={`music-video-mini-toggle ${className}`.trim()}
    >
      <span>
        <strong>{t("music.videos.mini")}</strong>
        <small>{t("music.videos.miniHint")}</small>
      </span>
      <span
        aria-hidden
        className={`relative block h-6 w-10 shrink-0 rounded-full transition-colors ${
          mini.enabled ? "bg-ink" : "bg-edge"
        }`}
      >
        <span
          className={`absolute start-[3px] top-[3px] h-[18px] w-[18px] rounded-full bg-canvas transition-transform ${
            mini.enabled ? "translate-x-4 rtl:-translate-x-4" : "translate-x-0"
          }`}
        />
      </span>
    </button>
  );
}
