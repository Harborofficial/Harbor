import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n";
import { SettingRow, ROW_ACTION_DANGER, ROW_ACTION_PRIMARY } from "./kit";

type ModelStatus = {
  supported: boolean;
  installed: boolean;
  sizeBytes: number | null;
};

type Progress = { received: number; total: number };

function megabytes(bytes: number): string {
  return (bytes / 1_048_576).toFixed(1);
}

export function WhisperModelRow() {
  const t = useT();
  const [status, setStatus] = useState<ModelStatus | null>(null);
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState<"download" | "remove" | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    void invoke<ModelStatus>("asr_model_status")
      .then((next) => {
        if (mounted) setStatus(next);
      })
      .catch((reason) => {
        if (mounted) setError(String(reason));
      })
      .finally(() => {
        if (mounted) setChecking(false);
      });
    const listener = listen<[number, number]>("asr-model://progress", (event) => {
      if (!mounted) return;
      const [received, total] = event.payload;
      if (Number.isFinite(received) && Number.isFinite(total)) {
        setProgress({ received, total });
      }
    }).catch(() => null);
    return () => {
      mounted = false;
      void listener.then((unlisten) => unlisten?.());
    };
  }, []);

  const perform = async (action: "download" | "remove") => {
    if (busy) return;
    setBusy(action);
    setError(null);
    setProgress(null);
    try {
      await invoke(action === "download" ? "asr_model_download" : "asr_model_remove");
      setStatus(await invoke<ModelStatus>("asr_model_status"));
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(null);
      setProgress(null);
    }
  };

  const installed = status?.installed === true;
  const supported = status?.supported === true;
  const percentage =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.received / progress.total) * 100))
      : null;

  const description = checking
    ? t("Checking speech model…")
    : !supported
      ? t("Whisper is not included in this build. Install a Windows Harbor build with Whisper support.")
      : installed
        ? t("Installed locally. The model is used for difficult subtitle sync attempts.")
        : t("Optional one-time download. Speech recognition runs on your device; the model is kept between app updates.");

  return (
    <>
      <SettingRow label={t("Whisper Tiny speech model")} desc={description}>
        {supported && !checking && (
          <button
            type="button"
            disabled={busy !== null}
            aria-busy={busy !== null}
            onClick={() => void perform(installed ? "remove" : "download")}
            className={installed ? ROW_ACTION_DANGER : ROW_ACTION_PRIMARY}
          >
            {busy === "download"
              ? t("Downloading…")
              : busy === "remove"
                ? t("Removing…")
                : installed
                  ? t("Remove model")
                  : t("Download model")}
          </button>
        )}
      </SettingRow>
      {installed && status?.sizeBytes != null && (
        <p className="ps-4 text-[13px] text-ink-muted">
          {t("Installed size")}: {megabytes(status.sizeBytes)} MB
        </p>
      )}
      {busy === "download" && (
        <div role="status" aria-live="polite" className="flex flex-col gap-1.5 ps-4 text-[13px] text-ink-muted">
          <span>
            {progress
              ? percentage !== null
                ? `${t("Downloading model")}: ${percentage}% (${megabytes(progress.received)} / ${megabytes(progress.total)} MB)`
                : `${t("Downloading model")}: ${megabytes(progress.received)} MB`
              : t("Connecting to model server…")}
          </span>
          {percentage !== null && (
            <progress value={percentage} max={100} aria-label={t("Whisper model download progress")} className="h-2 w-full max-w-[440px]" />
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="ps-4 text-[13px] text-danger">
          {t("Speech model operation failed")}: {error}
        </p>
      )}
    </>
  );
}
