import { useEffect, useState } from "react";
import { ArrowLeft, ChevronRight, FolderOpen, HardDrive } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { Dropdown } from "@/components/dropdown";
import { useT } from "@/lib/i18n";
import { transferBytes } from "@/lib/games/transfers";
import { setupParent } from "@/lib/games/setup-locations";
import "./game-download-destination.css";

type Location = { path: string; label: string; availableBytes: number | null };
type Locations = { drives: Location[]; selected: Location | null };
const HEADROOM = 32 * 1024 * 1024;

export function TorrentDestination({
  parent,
  name,
  needed,
  disabled,
  setParent,
  setName,
  pick,
  onInsufficient,
}: {
  parent: string;
  name: string;
  needed: number;
  disabled: boolean;
  setParent: (path: string) => void;
  setName: (name: string) => void;
  pick: () => void;
  onInsufficient: (value: boolean) => void;
}) {
  const t = useT(),
    [locations, setLocations] = useState<Locations>({ drives: [], selected: null }),
    [pending, setPending] = useState(true),
    [unavailable, setUnavailable] = useState(false);
  const [showFolders, setShowFolders] = useState(false);
  const [folders, setFolders] = useState<Location[]>([]);
  const [folderPending, setFolderPending] = useState(false);
  const [folderFailed, setFolderFailed] = useState(false);
  useEffect(() => {
    let live = true;
    setPending(true);
    const refresh = async () => {
      try {
        const value = await invoke<Locations>("games_download_locations", {
          parent: parent || null,
        });
        if (live) {
          setLocations(value);
          setUnavailable(false);
        }
      } catch {
        if (live) {
          setLocations({ drives: [], selected: null });
          setUnavailable(true);
        }
      } finally {
        if (live) setPending(false);
      }
    };
    void refresh();
    const interval = window.setInterval(() => void refresh(), 15000);
    return () => {
      live = false;
      window.clearInterval(interval);
    };
  }, [parent]);
  useEffect(() => {
    if (!showFolders || !parent) {
      setFolders([]);
      return;
    }
    let live = true;
    setFolderPending(true);
    setFolderFailed(false);
    setFolders([]);
    void invoke<Location[]>("games_download_folders", { parent })
      .then((items) => {
        if (live) setFolders(items);
      })
      .catch(() => {
        if (live) setFolderFailed(true);
      })
      .finally(() => {
        if (live) setFolderPending(false);
      });
    return () => {
      live = false;
    };
  }, [parent, showFolders]);
  const available = locations.selected?.path === parent ? locations.selected.availableBytes : null;
  const insufficient = available != null && needed > 0 && available < needed + HEADROOM;
  useEffect(() => onInsufficient(insufficient), [insufficient, onInsufficient]);
  const drive = locations.drives.find((item) => item.path === parent);
  const path = parent
    ? `${parent.replace(/[\\/]+$/, "")}${parent.includes("\\") ? "\\" : "/"}${name}`
    : "";
  return (
    <section className="games-torrent-destination">
      <h3>{t("games.torrent.destination")}</h3>
      <div className="games-torrent-location-controls">
        <fieldset disabled={disabled || pending || !locations.drives.length}>
          <Dropdown
            value={drive?.path ?? ""}
            ariaLabel={t("games.torrent.drive")}
            placeholder={t(pending ? "games.torrent.loadingDrives" : "games.torrent.drive")}
            options={locations.drives.map((item) => ({
              value: item.path,
              label: `${item.label}${item.availableBytes == null ? "" : ` · ${t("games.torrent.free", { size: transferBytes(item.availableBytes) })}`}`,
              left: <HardDrive size={18} />,
            }))}
            onChange={setParent}
            className="games-torrent-drive"
          />
        </fieldset>
        <button className="games-button" disabled={disabled} onClick={pick}>
          <FolderOpen size={18} />
          {t("games.torrent.browse")}
        </button>
      </div>
      {parent && (
        <div className="games-torrent-folder-toggle">
          <button
            type="button"
            className="games-button"
            disabled={disabled}
            aria-expanded={showFolders}
            onClick={() => setShowFolders((value) => !value)}
          >
            <FolderOpen size={17} />
            {t("games.download.folders")}
          </button>
        </div>
      )}
      {showFolders && parent && (
        <div className="games-destination-folder-browser">
          <div className="games-destination-folder-toolbar">
            <button
              type="button"
              className="games-button"
              disabled={disabled || !setupParent(parent)}
              onClick={() => setParent(setupParent(parent))}
            >
              <ArrowLeft size={16} />
              {t("games.download.folderUp")}
            </button>
            <span dir="ltr" title={parent}>
              {parent}
            </span>
          </div>
          {folderPending ? (
            <p role="status">{t("common.loading")}</p>
          ) : folderFailed ? (
            <p role="status">{t("games.download.foldersUnavailable")}</p>
          ) : folders.length ? (
            <div className="games-destination-subfolders">
              {folders.map((folder) => (
                <button
                  type="button"
                  key={folder.path}
                  disabled={disabled}
                  onClick={() => setParent(folder.path)}
                >
                  <FolderOpen size={18} />
                  <span>{folder.label}</span>
                  <ChevronRight size={16} />
                </button>
              ))}
            </div>
          ) : (
            <p>{t("games.download.noFolders")}</p>
          )}
        </div>
      )}
      {unavailable && (
        <p className="games-torrent-space-note">{t("games.torrent.drivesUnavailable")}</p>
      )}
      <label>
        {t("games.torrent.folderName")}
        <input
          value={name}
          maxLength={180}
          disabled={disabled}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      {parent && (
        <p className="games-torrent-destination-path" title={path}>
          <FolderOpen size={15} />
          <span dir="ltr">{path.replace(/^\\\\\?\\/, "")}</span>
        </p>
      )}
      <div
        className={`games-torrent-space-note ${insufficient ? "is-insufficient" : ""}`}
        role="status"
      >
        <span>{t("games.torrent.required", { size: transferBytes(needed + HEADROOM) })}</span>
        {available != null && (
          <strong>{t("games.torrent.free", { size: transferBytes(available) })}</strong>
        )}
        {insufficient && <p>{t("games.torrent.notEnoughSpace")}</p>}
      </div>
    </section>
  );
}
