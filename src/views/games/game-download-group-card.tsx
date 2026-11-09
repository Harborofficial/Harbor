import { useState, type ReactNode } from "react";
import { ChevronDown, Gamepad2, Link2, LoaderCircle, Pause, Play, Trash2 } from "lucide-react";
import { useT } from "@/lib/i18n";
import {
  downloadGame,
  downloadProgress,
  downloadRemaining,
} from "@/lib/games/download-presentation";
import { GameHeroLogo } from "./game-hero-logo";
import { transferBytes } from "@/lib/games/transfers";
import {
  groupArtworkItem,
  groupDownloadAction,
  groupVerification,
  groupStatusKey,
  type GameDownloadBundle,
  type GroupDownloadAction,
} from "@/lib/games/download-game-groups";
import { DownloadArtwork } from "./game-download-activity";

export function GameDownloadGroupCard({
  group,
  featured = false,
  children,
  onGroupAction,
  onUpdateLink,
  onDelete,
  busy = false,
  canUseRelink = false,
}: {
  group: GameDownloadBundle;
  featured?: boolean;
  children: ReactNode;
  busy?: boolean;
  canUseRelink?: boolean;
  onGroupAction: (action: GroupDownloadAction) => void;
  onUpdateLink: () => void;
  onDelete: () => void;
}) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const percent = downloadProgress(group.received, group.total);
  const verifying = groupVerification(group);
  const verifyPercent = verifying
    ? downloadProgress(verifying.received, verifying.total)
    : undefined;
  const verifyRemaining = verifying
    ? downloadRemaining(verifying.received, verifying.total, verifying.speed)
    : undefined;
  const first = groupArtworkItem(group);
  const game = downloadGame(first.record);
  const logo = group.items
    .map((item) => downloadGame(item.record)?.logo)
    .find((value): value is string => !!value);
  const hasArtwork = featured && !!game?.artwork;
  const command = groupDownloadAction(group);
  const pause = command?.action === "pause";
  const label = t(pause ? "games.download.bundle.pause" : "games.download.bundle.resume", {
    name: group.name,
  });
  const direct = group.items.filter((item) => item.kind === "direct");
  const canRelink = direct.some((item) => ["paused", "failed"].includes(item.record.status));
  const toggle = () => setExpanded((previous) => !previous);
  return (
    <article
      className={
        featured
          ? "games-download-bundle is-featured has-banner" +
            (hasArtwork ? " has-artwork" : " no-artwork")
          : "games-download-bundle"
      }
      data-download-group={group.key}
      onClick={(event) => {
        const target = event.target;
        if (
          !(target instanceof Element) ||
          target.closest("button,a,input,select,textarea,.games-download-bundle-files")
        )
          return;
        toggle();
      }}
    >
      {featured && (
        <div
          className={"games-download-bundle-hero" + (hasArtwork ? "" : " is-placeholder")}
          aria-hidden="true"
        >
          {hasArtwork ? (
            <DownloadArtwork item={first} hero />
          ) : (
            <Gamepad2
              className="games-download-bundle-hero-placeholder-icon"
              size={82}
              strokeWidth={1.1}
            />
          )}
        </div>
      )}
      <div className="games-download-bundle-top">
        <button
          type="button"
          className="games-download-bundle-expand"
          onClick={toggle}
          aria-expanded={expanded}
          aria-label={t("games.download.bundle.toggle", { name: group.name })}
        >
          <ChevronDown
            size={19}
            className={
              expanded
                ? "games-download-bundle-chevron is-expanded"
                : "games-download-bundle-chevron"
            }
          />
          {!featured && <DownloadArtwork item={first} />}
          <span className="games-download-bundle-heading">
            {featured && logo && (
              <GameHeroLogo
                sources={[logo]}
                name={group.name}
                platformIds={[]}
                ready
                active={featured}
                className="games-download-bundle-logo"
              />
            )}
            <strong>{group.name}</strong>
            <span>{t("games.download.bundle.files", { count: group.items.length })}</span>
            <span className="games-download-bundle-state">{t(groupStatusKey(group))}</span>
          </span>
        </button>
        <div className="games-download-bundle-controls">
          <div className="games-download-bundle-rate">
            <span className="games-download-bundle-rate-label">
              {t("games.download.bundle.speed")}:
            </span>
            <strong dir="ltr">{group.rate > 0 ? transferBytes(group.rate) + "/s" : "0 B/s"}</strong>
          </div>
          <div className="games-download-bundle-buttons">
            {command && (
              <button
                type="button"
                className="games-button games-download-bundle-toggle"
                disabled={busy}
                aria-label={label}
                title={label}
                onClick={() => onGroupAction(command.action)}
              >
                {busy ? (
                  <LoaderCircle size={17} className="games-download-spinner" />
                ) : pause ? (
                  <Pause size={17} fill="currentColor" />
                ) : (
                  <Play size={17} fill="currentColor" />
                )}
                <span>
                  {t(
                    pause
                      ? "games.download.bundle.pauseShort"
                      : "games.download.bundle.resumeShort",
                  )}
                </span>
              </button>
            )}
            {direct.length > 0 && (
              <button
                type="button"
                className="games-icon-button games-download-bundle-link"
                disabled={busy || !canRelink || !canUseRelink}
                onClick={onUpdateLink}
                title={t(
                  canRelink ? "games.download.relink.title" : "games.download.bundle.pauseToRelink",
                )}
                aria-label={t("games.download.relink.title")}
              >
                <Link2 size={17} />
              </button>
            )}
            <button
              type="button"
              className="games-icon-button games-download-bundle-delete"
              disabled={busy}
              onClick={onDelete}
              title={t("games.download.bundle.delete")}
              aria-label={t("games.download.bundle.delete")}
            >
              <Trash2 size={17} />
            </button>
          </div>
        </div>
      </div>
      <button
        type="button"
        className="games-download-bundle-progress-action"
        onClick={toggle}
        aria-expanded={expanded}
        aria-label={t("games.download.bundle.toggle", { name: group.name })}
      >
        <span className="games-download-bundle-progress-label">
          <strong>
            {group.completed === group.items.length
              ? t("games.download.center.downloadComplete")
              : t("games.download.bundle.overall")}
          </strong>
          <span dir="ltr">
            {transferBytes(group.received)}
            {group.total !== null && <> / {transferBytes(group.total)}</>}
            {percent !== undefined && <> ({Math.round(percent)}%)</>}
          </span>
        </span>
        <span
          className="games-download-progress"
          role="progressbar"
          aria-label={t("games.download.bundle.overall")}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent === undefined ? undefined : Math.round(percent)}
        >
          <i style={{ width: (percent ?? 0) + "%" }} />
        </span>
      </button>
      {verifying && (
        <p className="games-download-bundle-verifying" role="status">
          <strong>{t("games.download.relink.checking")}</strong>
          <span dir="ltr">
            {transferBytes(verifying.received)} / {transferBytes(verifying.total)}
            {verifyPercent !== undefined && <> ({Math.round(verifyPercent)}%)</>}
          </span>
          {verifyRemaining && (
            <span>{t("games.download.relink.timeRemaining", { time: verifyRemaining })}</span>
          )}
        </p>
      )}
      {expanded && (
        <div
          className="games-download-bundle-files"
          aria-label={t("games.download.bundle.details", { count: group.items.length })}
        >
          {children}
        </div>
      )}
    </article>
  );
}
