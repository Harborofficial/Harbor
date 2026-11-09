import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  ArrowDown,
  Check,
  CloudDownload as CloudDownloadIcon,
  Folder,
  RefreshCw,
} from "lucide-react";
import type { GameTransfers } from "@/hooks/use-game-transfers";
import type { CloudEntry, CloudKeys, CloudDownload } from "@/lib/games/cloud-files";
import {
  connectedMagnetProviders,
  magnetCloudProvider,
  preferredMagnetProvider,
  rememberMagnetProvider,
  validCloudJobId,
} from "@/lib/games/magnet-debrid";
import {
  SOURCE_LINK_SERVICES,
  type SourceLink,
  type SourceLinkProvider,
  sourceLinkError,
} from "@/lib/games/source-links";
import { useT } from "@/lib/i18n";
import { transferBytes } from "@/lib/games/transfers";
import { GameFileIcon } from "./game-file-icon";
import { GameCloudDialog } from "./game-cloud";
import rdLogo from "@/assets/addon-logos/realdebrid.png";
import tbLogo from "@/assets/addon-logos/torbox.png";
import pmLogo from "@/assets/addon-logos/premiumize.png";
import adLogo from "@/assets/addon-logos/alldebrid.webp";

type MagnetJob = {
  id: string;
  status: "preparing" | "ready" | "failed";
  files: CloudEntry[];
};

const logos = { rd: rdLogo, tb: tbLogo, pm: pmLogo, ad: adLogo };

async function intentKey(profile: string, provider: string, key: string, url: string) {
  // Never persist API keys or magnet URIs in clear text.
  const identity = JSON.stringify(["magnet", profile, provider, key.trim(), url]);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(identity));
  return (
    "harbor.games.magnet-job.v1." +
    Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("")
  );
}
function readJob(key: string): string | "unknown" | null {
  try {
    const id = localStorage.getItem(key);
    return id === "unknown" || validCloudJobId(id) ? id : null;
  } catch {
    return null;
  }
}
function writeJob(key: string, id: string | "unknown") {
  try {
    localStorage.setItem(key, id);
  } catch {
    /* storage unavailable */
  }
}

export function SourceMagnetDebrid({
  link,
  downloads,
  keys,
  openSettings,
  onDone,
}: {
  link: SourceLink;
  downloads: GameTransfers;
  keys: CloudKeys;
  openSettings?: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const connected = connectedMagnetProviders(keys);
  const connectedId = connected.join(",");
  const [method, setMethod] = useState<"native" | "debrid">(() =>
    connected.length ? "debrid" : "native",
  );
  const [provider, setProvider] = useState<SourceLinkProvider | null>(() =>
    preferredMagnetProvider(downloads.profile, connected),
  );
  const chosen = provider && connected.includes(provider) ? provider : (connected[0] ?? null);
  const key = chosen ? (keys[chosen]?.trim() ?? "") : "";
  const [jobId, setJobId] = useState<string | "unknown" | null>(null);
  const [job, setJob] = useState<MagnetJob | null>(null);
  const [storageId, setStorageId] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [browse, setBrowse] = useState<CloudEntry | null>(null);
  const alive = useRef(true);
  const generation = useRef(0);
  const pending = useRef(false);
  const serviceName = SOURCE_LINK_SERVICES.find((service) => service.id === chosen)?.name ?? "";
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      generation.current++;
    };
  }, []);
  useEffect(() => {
    setProvider(preferredMagnetProvider(downloads.profile, connected));
  }, [downloads.profile, connectedId]);

  useEffect(() => {
    const revision = ++generation.current;
    setLoaded(false);
    setStorageId("");
    setJobId(null);
    setJob(null);
    setSelected([]);
    setError("");
    setBusy(false);
    pending.current = false;
    if (!chosen || !key || !downloads.available) {
      setLoaded(true);
      return;
    }
    void intentKey(downloads.profile, chosen, key, link.url)
      .then((id) => {
        if (revision !== generation.current || !alive.current) return;
        setStorageId(id);
        setJobId(readJob(id));
        setLoaded(true);
      })
      .catch(() => {
        if (revision === generation.current && alive.current) {
          setError("games.sources.web.storage");
          setLoaded(true);
        }
      });
  }, [chosen, key, downloads.profile, link.url, downloads.available]);

  const args = { provider: chosen, key, url: link.url };
  async function refresh(id = jobId) {
    if (!chosen || !key || !id || id === "unknown" || pending.current) return;
    const revision = generation.current;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await invoke<MagnetJob>("games_cloud_magnet_status", {
        args: { ...args, parent: id },
      });
      if (!alive.current || revision !== generation.current) return;
      setJob(result);
      setSelected((previous) =>
        previous.length || result.status !== "ready"
          ? previous
          : result.files
              .filter((file) => file.kind === "file" && file.ready)
              .map((file) => file.id),
      );
    } catch (reason) {
      if (alive.current && revision === generation.current) setError(sourceLinkError(reason));
    } finally {
      if (alive.current && revision === generation.current) {
        pending.current = false;
        setBusy(false);
      }
    }
  }
  useEffect(() => {
    if (validCloudJobId(jobId) && loaded) void refresh(jobId);
  }, [loaded, jobId, chosen, key]);
  useEffect(() => {
    if (!validCloudJobId(jobId) || job?.status !== "preparing") return;
    let count = 0;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible" && count++ < 30) void refresh(jobId);
    }, 8000);
    return () => clearInterval(timer);
  }, [jobId, job?.status, chosen, key]);

  const chooseProvider = (value: SourceLinkProvider) => {
    if (pending.current || !connected.includes(value)) return;
    setProvider(value);
    rememberMagnetProvider(downloads.profile, value);
  };
  const submit = async (repeat = false) => {
    if (!chosen || !key || !storageId || pending.current || !downloads.available) return;
    if (!repeat && jobId) return;
    const revision = generation.current;
    pending.current = true;
    setBusy(true);
    setError("");
    // An ambiguous network failure must never automatically submit twice.
    writeJob(storageId, "unknown");
    setJobId("unknown");
    try {
      const id = await invoke<string>("games_cloud_magnet_create", { args });
      if (!validCloudJobId(id)) throw Error("cloud_metadata");
      writeJob(storageId, id);
      if (revision !== generation.current || !alive.current) return;
      setJobId(id);
      setJob({ id, status: "preparing", files: [] });
    } catch (reason) {
      if (revision === generation.current && alive.current) setError(sourceLinkError(reason));
    } finally {
      if (revision === generation.current && alive.current) {
        pending.current = false;
        setBusy(false);
      }
    }
  };
  const available = job?.status === "ready" ? job.files.filter((file) => file.ready) : [];
  const chosenFiles = available.filter(
    (file) => file.kind === "file" && selected.includes(file.id),
  );
  const downloading = downloads.busy.includes("new");
  const download = async () => {
    if (
      !chosen ||
      !job ||
      job.status !== "ready" ||
      !chosenFiles.length ||
      pending.current ||
      downloading
    )
      return;
    const revision = generation.current;
    pending.current = true;
    setBusy(true);
    setError("");
    downloads.dismissError();
    try {
      const results: CloudDownload[] = [];
      for (const file of chosenFiles) {
        results.push(
          await invoke<CloudDownload>("games_cloud_magnet_download", {
            args: { ...args, parent: job.id, file: file.id },
          }),
        );
      }
      if (!alive.current || revision !== generation.current) return;
      const started =
        results.length === 1
          ? await downloads.start(
              {
                url: results[0].url,
                name: link.title,
                game: link.game,
                expectedBytes: results[0].expectedBytes ?? undefined,
                torboxOrigin: chosen==="tb" ? {torrentId:job.id,fileId:chosenFiles[0].id} : undefined,
              },
              results[0].name,
            )
          : await downloads.startBatch(
              results.map((file,index) => ({
                url: file.url,
                filename: file.name,
                name: file.name,
                game: link.game,
                expectedBytes: file.expectedBytes ?? undefined,
                torboxOrigin: chosen==="tb" ? {
                  torrentId:job.id,fileId:chosenFiles[index].id,
                } : undefined,
              })),
            );
      if (started && alive.current && revision === generation.current) onDone();
    } catch (reason) {
      if (alive.current && revision === generation.current) setError(sourceLinkError(reason));
    } finally {
      if (alive.current && revision === generation.current) {
        pending.current = false;
        setBusy(false);
      }
    }
  };

  return (
    <div className="games-source-link-content">
      <div
        className="games-source-link-modes games-source-download-methods"
        role="group"
        aria-label={t("games.sources.download.method")}
      >
        <button
          type="button"
          aria-pressed={method === "native"}
          disabled={busy || downloading}
          onClick={() => setMethod("native")}
        >
          {t("games.sources.download.native")}
        </button>
        <button
          type="button"
          aria-pressed={method === "debrid"}
          disabled={busy || downloading}
          onClick={() => setMethod("debrid")}
        >
          {t("games.magnet.debrid")}
        </button>
      </div>
      {method === "native" ? (
        <div className="games-source-link-body">
          <p>{t("games.sources.download.nativeNote")}</p>
        </div>
      ) : (
        <div className="games-source-link-body games-source-magnet-body">
          {!downloads.available ? (
            <p>{t("games.download.desktopTitle")}</p>
          ) : !connected.length ? (
            <div className="games-source-link-connect">
              <p>{t("games.magnet.none")}</p>
              {openSettings && (
                <button
                  className="games-button"
                  onClick={() => {
                    onDone();
                    openSettings();
                  }}
                >
                  {t("games.magnet.connect")}
                </button>
              )}
            </div>
          ) : (
            <>
              <p>{t("games.magnet.choose")}</p>
              <div
                className="games-source-link-providers"
                aria-label={t("games.sources.links.service")}
              >
                {connected.map((option) => (
                  <button
                    type="button"
                    key={option}
                    aria-pressed={chosen === option}
                    disabled={busy || downloading}
                    onClick={() => chooseProvider(option)}
                  >
                    <img src={logos[option]} alt="" />
                    <span>
                      {SOURCE_LINK_SERVICES.find((service) => service.id === option)?.name}
                    </span>
                    {chosen === option && <Check size={15} />}
                  </button>
                ))}
              </div>
              {!loaded ? (
                <p>{t("common.loading")}</p>
              ) : !jobId ? (
                <p>{t("games.magnet.remember")}</p>
              ) : jobId === "unknown" ? (
                <div className="games-web-job-actions">
                  <p role="status">{t("games.sources.web.uncertain")}</p>
                  {chosen !== "ad" && (
                    <button
                      className="games-button"
                      onClick={() => {
                        setBrowse({
                          id: "",
                          name: "",
                          kind: "folder",
                          bytes: null,
                          ready: true,
                          status: "ready",
                        });
                      }}
                    >
                      {t("games.magnet.browse")}
                    </button>
                  )}
                  <button
                    className="games-button"
                    disabled={busy}
                    onClick={() => void submit(true)}
                  >
                    {t("games.sources.web.again")}
                  </button>
                </div>
              ) : (
                <>
                  <div className="games-web-job-status">
                    <strong>{serviceName}</strong>
                    <span role="status">
                      {t(
                        job?.status === "failed"
                          ? "games.magnet.failed"
                          : job?.status === "ready"
                            ? "games.magnet.review"
                            : "games.magnet.preparing",
                      )}
                    </span>
                    <button
                      className="games-icon-button"
                      type="button"
                      aria-label={t("games.magnet.refresh")}
                      disabled={busy}
                      onClick={() => void refresh()}
                    >
                      <RefreshCw size={17} />
                    </button>
                  </div>
                  {available.length > 0 && (
                    <div
                      className="games-source-link-files"
                      role="group"
                      aria-label={t("games.magnet.select")}
                    >
                      {available.map((file) => (
                        <button
                          key={file.id}
                          type="button"
                          role={file.kind === "file" ? "checkbox" : undefined}
                          aria-checked={
                            file.kind === "file" ? selected.includes(file.id) : undefined
                          }
                          onClick={() => {
                            if (file.kind === "folder") {
                              setBrowse(file);
                              return;
                            }
                            setSelected((previous) =>
                              previous.includes(file.id)
                                ? previous.filter((id) => id !== file.id)
                                : downloads.selectionOnly
                                  ? [file.id]
                                  : [...previous, file.id],
                            );
                          }}
                        >
                          {file.kind === "folder" ? (
                            <Folder size={20} />
                          ) : (
                            <GameFileIcon name={file.name} />
                          )}
                          <span>
                            <strong>{file.name}</strong>
                            <small>
                              {file.bytes
                                ? transferBytes(file.bytes)
                                : t("games.sources.links.unknownSize")}
                            </small>
                          </span>
                          {file.kind === "file" && selected.includes(file.id) && (
                            <Check size={17} />
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </>
          )}
          {error && (
            <p role="alert" className="games-source-batch-error">
              {t(error)}
            </p>
          )}
          {downloads.error && (
            <p role="alert" className="games-source-batch-error">
              {t(downloads.error)}
            </p>
          )}
        </div>
      )}
      <footer>
        <span>
          {method === "native"
            ? t("games.sources.download.nativeNote")
            : jobId
              ? t("games.magnet.submitted")
              : t("games.sources.links.note")}
        </span>
        {method === "native" ? (
          <button
            type="button"
            className="games-button games-button-primary"
            disabled={!downloads.torrents.available || busy || downloading}
            onClick={() => {
              downloads.torrents.begin(link.url, link.game);
              onDone();
            }}
          >
            <ArrowDown size={16} />
            {t("games.sources.art.reviewTorrent")}
          </button>
        ) : (
          connected.length > 0 &&
          loaded &&
          downloads.available &&
          (!jobId ? (
            <button
              className="games-button games-button-primary"
              disabled={busy}
              onClick={() => void submit()}
            >
              <CloudDownloadIcon size={17} />
              {t("games.magnet.prepare", { name: serviceName })}
            </button>
          ) : available.some((file) => file.kind === "file") && chosenFiles.length > 0 ? (
            <button
              className="games-button games-button-primary"
              disabled={busy || downloading}
              onClick={() => void download()}
            >
              <ArrowDown size={16} />
              {t("games.magnet.download")}
            </button>
          ) : null)
        )}
      </footer>
      {method === "debrid" && browse && chosen && magnetCloudProvider(chosen) && (
        <GameCloudDialog
          downloads={downloads}
          keys={keys}
          initialProvider={chosen}
          initialFolder={browse.id ? browse : undefined}
          openSettings={openSettings}
          onClose={() => setBrowse(null)}
        />
      )}
    </div>
  );
}
