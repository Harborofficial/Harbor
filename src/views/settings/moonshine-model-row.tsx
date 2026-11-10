import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { useSettings } from "@/lib/settings";
import { useT } from "@/lib/i18n";
import { SettingRow, ROW_ACTION_PRIMARY, ROW_ACTION_DANGER } from "./kit";
import {
  MOONSHINE_LANGUAGES,
  isMoonshineLanguage,
  type MoonshineLanguage,
  type MoonshineModelStatus,
} from "@/lib/subtitles/autosync/moonshine-models";

export function MoonshineModelRow() {
  const t = useT();
  const { settings, update } = useSettings();
  const selectedPreference = settings.subtitleMoonshineLanguage || "auto";
  const [manageLanguage, setManageLanguage] = useState<MoonshineLanguage>(
    isMoonshineLanguage(selectedPreference) ? selectedPreference : "en",
  );
  const [status, setStatus] = useState<MoonshineModelStatus | null>(null);
  const [busy, setBusy] = useState<"runtime" | "download" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isMoonshineLanguage(selectedPreference)) setManageLanguage(selectedPreference);
  }, [selectedPreference]);

  useEffect(() => {
    let active = true;
    setStatus(null);
    setError(null);
    void invoke<MoonshineModelStatus>("moonshine_model_status", { language: manageLanguage })
      .then((result) => {
        if (active) setStatus(result);
      })
      .catch((reason) => {
        if (active) setError(String(reason));
      });
    return () => {
      active = false;
    };
  }, [manageLanguage]);

  async function perform(mode: "runtime" | "download" | "remove") {
    if (busy) return;
    setBusy(mode);
    setError(null);
    try {
      if (mode === "runtime") {
        await invoke("moonshine_runtime_install");
      } else {
        await invoke(mode === "download" ? "moonshine_model_download" : "moonshine_model_remove", {
          language: manageLanguage,
        });
      }
      setStatus(
        await invoke<MoonshineModelStatus>("moonshine_model_status", {
          language: manageLanguage,
        }),
      );
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <SettingRow
        label={t("Moonshine language")}
        desc={t(
          "Automatic uses the currently selected audio track. It never guesses from subtitles or downloads a model without approval. Override this if an audio track has incorrect language metadata.",
        )}
      >
        <select
          value={selectedPreference}
          onChange={(event) => update({ subtitleMoonshineLanguage: event.target.value })}
          aria-label={t("Moonshine language selection")}
          className="min-h-10 rounded-lg border border-edge-soft bg-elevated px-3 text-sm text-ink"
        >
          <option value="auto">{t("Automatic (audio track)")}</option>
          {MOONSHINE_LANGUAGES.map(([code, name]) => (
            <option key={code} value={code}>
              {name}
            </option>
          ))}
        </select>
      </SettingRow>
      <SettingRow
        label={t("Manage Moonshine models")}
        desc={t(
          "Download only the languages you want. Models remain installed between playback sessions; switching languages does not trigger a download. Silero works without Moonshine models.",
        )}
      >
        <select
          value={manageLanguage}
          onChange={(event) => setManageLanguage(event.target.value as MoonshineLanguage)}
          disabled={busy !== null}
          aria-label={t("Language model to manage")}
          className="min-h-10 rounded-lg border border-edge-soft bg-elevated px-3 text-sm text-ink"
        >
          {MOONSHINE_LANGUAGES.map(([code, name]) => (
            <option key={code} value={code}>
              {name}
            </option>
          ))}
        </select>
      </SettingRow>
      <div className="flex flex-wrap items-center gap-2 ps-4 text-[13px] text-ink-muted">
        {!status ? (
          <span>{t("Checking Moonshine…")}</span>
        ) : !status.supported ? (
          <span>
            {t(
              "The experimental runtime needs Python 3. Native runtime bundling is not yet available in this build.",
            )}
          </span>
        ) : !status.runtimeInstalled ? (
          <button
            type="button"
            disabled={busy !== null}
            aria-busy={busy !== null}
            onClick={() => void perform("runtime")}
            className={ROW_ACTION_PRIMARY}
          >
            {busy === "runtime" ? t("Installing…") : t("Install Moonshine test runtime")}
          </button>
        ) : (
          <>
            <span>
              {status.installed ? t("Language model installed") : t("Language model not installed")}
            </span>
            <button
              type="button"
              disabled={busy !== null}
              aria-busy={busy !== null}
              onClick={() => void perform(status.installed ? "remove" : "download")}
              className={status.installed ? ROW_ACTION_DANGER : ROW_ACTION_PRIMARY}
            >
              {busy === "download"
                ? t("Downloading…")
                : busy === "remove"
                  ? t("Removing…")
                  : status.installed
                    ? t("Remove model")
                    : t("Download language model")}
            </button>
          </>
        )}
        {busy && <span role="status">{t("Processing Moonshine request…")}</span>}
      </div>
      {error && (
        <p role="alert" className="ps-4 text-[13px] text-danger">
          {t("Moonshine operation failed")}: {error}
        </p>
      )}
    </>
  );
}
