import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useSettings } from "@/lib/settings";
import { useT } from "@/lib/i18n";
import { isWindowsDesktop } from "@/lib/platform";
import { FolderOpen } from "../icons";
import { SettingGroup, SettingRow } from "../kit";
import { ToggleRow } from "../shared";
import { SButton } from "../ui";
import { Tag } from "./choice";

const FIELD =
  "h-11 w-full max-w-[520px] min-w-0 rounded-[10px] border border-edge-soft bg-elevated px-4 font-mono text-[16.5px] text-ink outline-none placeholder:text-ink-subtle/55 focus-visible:border-edge focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

/** This function only saves your text when you click away or press Enter */
function DraftField({
  value,
  placeholder,
  label,
  onCommit,
}: {
  value: string;
  placeholder: string;
  label: string;
  onCommit: (v: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft.trim() !== value) onCommit(draft.trim());
  };
  return (
    <input
      type="text"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
      }}
      onBlur={commit}
      placeholder={placeholder}
      spellCheck={false}
      autoComplete="off"
      aria-label={label}
      className={FIELD}
    />
  );
}

export function ExternalPlayerSection() {
  const { settings, update } = useSettings();
  const t = useT();
  const [error, setError] = useState("");

  const browse = async () => {
    setError("");
    try {
      const picked = await open({
        multiple: false,
        directory: false,
        filters: isWindowsDesktop() ? [{ name: "mpv", extensions: ["exe"] }] : undefined,
      });
      if (typeof picked === "string") update({ playerExternalMpvPath: picked });
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <SettingGroup label={t("External player")}>
      <ToggleRow
        label={t("Play in my own mpv")}
        badge={<Tag text={t("Experimental")} />}
        sub={t(
          "Opens videos in your installed mpv with your own mpv.conf, scripts and keys. Harbor follows it to save your progress and mark episodes watched.",
        )}
        value={settings.playerExternalMpv}
        onChange={(v) => update({ playerExternalMpv: v })}
      />
      {settings.playerExternalMpv && (
        <>
          <SettingRow
            wide
            label={t("mpv location")}
            desc={t("The mpv program to open. Leave empty to use mpv from your PATH.")}
          >
            <span className="flex w-full flex-wrap items-center gap-2.5">
              <DraftField
                value={settings.playerExternalMpvPath}
                placeholder={
                  isWindowsDesktop() ? "C:\\Program Files\\mpv\\mpv.exe" : "/usr/bin/mpv"
                }
                label={t("mpv location")}
                onCommit={(v) => update({ playerExternalMpvPath: v })}
              />
              <SButton onClick={() => void browse()}>
                <FolderOpen size={16} strokeWidth={2.2} />
                {t("Browse")}
              </SButton>
            </span>
            {error && (
              <p role="alert" className="text-[15px] text-danger">
                {error}
              </p>
            )}
          </SettingRow>
          <SettingRow
            wide
            label={t("mpv options")}
            desc={t("Extra command line options passed to mpv. Optional.")}
          >
            <DraftField
              value={settings.playerExternalMpvArgs}
              placeholder="--fullscreen --profile=anime"
              label={t("mpv options")}
              onCommit={(v) => update({ playerExternalMpvArgs: v })}
            />
          </SettingRow>
        </>
      )}
    </SettingGroup>
  );
}
