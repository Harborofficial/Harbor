import { useT } from "@/lib/i18n";
import { setMusicDockAutoHide, useMusicDockAutoHide } from "@/lib/music/dock-auto-hide";
import {
  MUSIC_DOCK_PARTS,
  MUSIC_DOCK_PART_LABELS,
  resetMusicDockLayout,
  setMusicDockLayout,
  useMusicDockLayout,
} from "@/lib/music/dock-layout";

export function MusicDockParts() {
  const t = useT();
  const layout = useMusicDockLayout();
  const autoHide = useMusicDockAutoHide();
  const hidden = MUSIC_DOCK_PARTS.filter((part) => !layout[part]).length;

  return (
    <section className="music-audio-section">
      <div className="music-audio-row">
        <label>{t("music.dock.parts.title")}</label>
        <button type="button" onClick={resetMusicDockLayout} disabled={hidden === 0}>
          {t("music.audio.reset")}
        </button>
      </div>
      <p>{t("music.dock.parts.body")}</p>
      <label className="music-audio-toggle">
        <input
          type="checkbox"
          checked={autoHide}
          onChange={(event) => setMusicDockAutoHide(event.target.checked)}
        />
        {t("music.dock.autoHide")}
      </label>
      <p>{t("music.dock.autoHideHelp")}</p>
      <div className="music-dock-parts">
        {MUSIC_DOCK_PARTS.map((part) => (
          <label key={part} className="music-audio-toggle">
            <input
              type="checkbox"
              checked={layout[part]}
              onChange={(event) => setMusicDockLayout({ [part]: event.target.checked })}
            />
            {t(MUSIC_DOCK_PART_LABELS[part])}
          </label>
        ))}
      </div>
    </section>
  );
}
