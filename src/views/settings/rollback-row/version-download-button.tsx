import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n";
import { isMacDesktop, isWindowsDesktop } from "@/lib/platform";
import { installerMode, resumedInstallerPhase } from "@/lib/updater/installer-plan";
import {
  downloadVersionInstaller,
  installStagedVersion,
  probeStagedInstaller,
  resolveSavedInstaller,
  revealInstaller,
  stageVersionInstaller,
  type InstallerProgress,
} from "@/lib/updater/version-download";
import { installerUrl, type VersionEntry } from "@/lib/updater/versions";
import { openUrl } from "@/lib/window";
import { ArrowDownToLine, FolderOpen, RotateCw } from "../icons";
import { SButton } from "../ui";

const IS_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

type Phase = "checking" | "idle" | "downloading" | "verifying" | "staged" | "saved";

export function VersionDownloadButton({
  entry,
  label,
  title,
  variant = "secondary",
}: {
  entry: VersionEntry;
  label: string;
  title?: string;
  variant?: "secondary" | "primary";
}) {
  const t = useT();
  const url = installerUrl(entry);
  const mode = installerMode(entry, {
    tauri: IS_TAURI,
    windows: isWindowsDesktop(),
    mac: isMacDesktop(),
  });
  const [phase, setPhase] = useState<Phase>("checking");
  const [progress, setProgress] = useState<InstallerProgress>({
    received: 0,
    total: null,
    verifying: false,
  });
  const [savedPath, setSavedPath] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    if (!IS_TAURI || mode === "browser" || !url) {
      setPhase("idle");
      return;
    }
    void (async () => {
      const staged = mode === "verified" ? await probeStagedInstaller(entry.version) : false;
      const saved = await resolveSavedInstaller(entry.version, url);
      if (!live) return;
      const next = resumedInstallerPhase(mode, staged, saved !== null);
      if (next === "saved" && saved) setSavedPath(saved);
      setPhase(next);
    })().catch(() => {
      if (live) setPhase("idle");
    });
    return () => {
      live = false;
    };
  }, [entry.version, mode, url]);

  if (!url) return null;

  const percent =
    progress.total && progress.total > 0
      ? Math.min(100, Math.round((progress.received / progress.total) * 100))
      : null;

  const start = async () => {
    if (phase === "checking") return;
    if (IS_TAURI && mode !== "browser") {
      const report = (next: InstallerProgress) => {
        setProgress(next);
        setPhase(next.verifying ? "verifying" : "downloading");
      };
      setPhase("downloading");
      setProgress({ received: 0, total: null, verifying: false });
      if (mode === "verified") {
        try {
          await stageVersionInstaller(entry, report);
          setPhase("staged");
          return;
        } catch {
          // An unusable signature still gets the plain in-app download.
        }
        setPhase("downloading");
        setProgress({ received: 0, total: null, verifying: false });
      }
      try {
        const path = await downloadVersionInstaller(entry, url, report);
        setSavedPath(path);
        setPhase("saved");
        void revealInstaller(path).catch(() => {});
        return;
      } catch {
        setPhase("idle");
      }
    }
    openUrl(url);
  };

  const install = async () => {
    try {
      await installStagedVersion(entry.version);
    } catch {
      // The staged copy disappeared or no longer verifies; offer a fresh download.
      setPhase("idle");
    }
  };

  if (phase === "downloading" || phase === "verifying") {
    return (
      <span className="text-[12px] leading-relaxed text-ink-subtle">
        {phase === "verifying"
          ? t("Verifying the download…")
          : percent !== null
            ? t("Downloading {pct}%", { pct: percent })
            : t("Downloading…")}
      </span>
    );
  }

  if (phase === "staged") {
    return (
      <SButton variant={variant} onClick={() => void install()}>
        <RotateCw size={16} strokeWidth={2.4} /> {t("Install and reopen")}
      </SButton>
    );
  }

  if (phase === "saved") {
    return (
      <SButton variant={variant} onClick={() => savedPath && void revealInstaller(savedPath)}>
        <FolderOpen size={16} strokeWidth={2.4} /> {t("Show in folder")}
      </SButton>
    );
  }

  return (
    <SButton
      variant={variant}
      onClick={() => void start()}
      title={title}
      disabled={phase === "checking"}
    >
      <ArrowDownToLine size={16} strokeWidth={2.4} /> {label}
    </SButton>
  );
}
