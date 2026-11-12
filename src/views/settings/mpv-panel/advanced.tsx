import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import {
  ChevronDown,
  Trash2,
  Edit3,
  Plus,
  Copy,
  Check,
  X,
  FileCode,
  AlertTriangle,
  AlertCircle,
  Lock,
  ArrowRight,
} from "lucide-react";
import { useSettings } from "@/lib/settings";
import { useT } from "@/lib/i18n";
import { RowNote, Section, useSettingsActiveContext } from "../shared";
import {
  compileMpvOptions,
  validateMpvOptions,
  validateInputConf,
  customShadersMpvLines,
  customScriptsMpvLines,
} from "@/lib/player/mpv-tuning";
import type { CustomFileItem } from "@/lib/settings/types";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export function AdvancedMpvSection() {
  const { settings, update } = useSettings();
  const t = useT();
  const { openPage } = useSettingsActiveContext();

  const isLocked = settings.playerEngine === "html5";

  const isDefaultHdr =
    !settings.playerHdrToSdr &&
    !settings.playerHdrOpaqueWindow &&
    (!settings.playerHdrStage || settings.playerHdrStage === "off");

  const currentHdrLabel = settings.playerHdrOpaqueWindow
    ? t("True HDR, separate window")
    : settings.playerHdrToSdr
      ? t("Tonemap to SDR")
      : settings.playerHdrStage && settings.playerHdrStage !== "off"
        ? t("True HDR, embedded")
        : t("Default");

  // Collapsible toggle states
  const [showMpvCompiled, setShowMpvCompiled] = useState(false);
  const [showInputCompiled, setShowInputCompiled] = useState(false);
  const [showShaderCompiled, setShowShaderCompiled] = useState(false);
  const [showScriptCompiled, setShowScriptCompiled] = useState(false);

  // Modal states for Code Editor & Removal Warning
  const [editingItem, setEditingItem] = useState<{
    item: CustomFileItem;
    type: "shader" | "script";
  } | null>(null);

  const [removingItem, setRemovingItem] = useState<{
    item: CustomFileItem;
    type: "shader" | "script";
  } | null>(null);

  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Track missing or moved/deleted shader and script files on disk
  const [missingItemIds, setMissingItemIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!isTauri) return;
    let cancelled = false;

    const checkFiles = async () => {
      try {
        const { exists } = await import("@tauri-apps/plugin-fs");
        const allItems = [
          ...(settings.customGlslShaders || []),
          ...(settings.customMpvScripts || []),
        ];
        const missing = new Set<string>();
        for (const item of allItems) {
          if (!item.path) {
            missing.add(item.id);
            continue;
          }
          const fileExists = await exists(item.path).catch(() => false);
          if (!fileExists) {
            missing.add(item.id);
          }
        }
        if (!cancelled) {
          setMissingItemIds(missing);
        }
      } catch {
        // Filesystem check fallback
      }
    };

    void checkFiles();

    const onFocus = () => {
      void checkFiles();
    };
    window.addEventListener("focus", onFocus);

    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
    };
  }, [settings.customGlslShaders, settings.customMpvScripts]);

  // Sync input.conf to harbor-input.conf in AppData whenever it changes
  useEffect(() => {
    if (!isTauri) return;
    const syncInputConf = async () => {
      try {
        const { appDataDir, join } = await import("@tauri-apps/api/path");
        const { writeTextFile } = await import("@tauri-apps/plugin-fs");
        const confPath = await join(await appDataDir(), "harbor-input.conf");
        await writeTextFile(confPath, settings.mpvInputConf || "");
      } catch {
        // AppData sync fallback
      }
    };
    void syncInputConf();
  }, [settings.mpvInputConf]);

  // Validation
  const mpvCheck = validateMpvOptions(settings.mpvExtraOptions || "");
  const compiledMpv = compileMpvOptions(settings);
  const inputCheck = validateInputConf(settings.mpvInputConf || "");

  // --- Handlers for Shaders ---
  const handleAddShader = async () => {
    if (!isTauri) return;
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        multiple: true,
        directory: false,
        filters: [{ name: "GLSL Shader", extensions: ["glsl", "hook"] }],
      });

      if (!selected) return;
      const paths = Array.isArray(selected) ? selected : [selected];

      const newShaders: CustomFileItem[] = [];
      for (const p of paths) {
        const ext = p.split(".").pop()?.toLowerCase();
        if (ext !== "glsl" && ext !== "hook") {
          setErrorMessage(
            t("Invalid file format: '{name}'. Only .glsl and .hook shader files are supported.", {
              name: p.split(/[/\\]/).pop() ?? p,
            }),
          );
          return;
        }
        const name = p.split(/[/\\]/).pop() || p;
        // Avoid duplicate by path
        if (!(settings.customGlslShaders || []).some((s) => s.path === p)) {
          newShaders.push({
            id: `shader-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
            name,
            path: p,
            enabled: true,
          });
        }
      }

      if (newShaders.length > 0) {
        update({
          customGlslShaders: [...(settings.customGlslShaders || []), ...newShaders],
        });
      }
    } catch (err) {
      setErrorMessage(String(err));
    }
  };

  const handleToggleShader = (id: string, enabled: boolean) => {
    update({
      customGlslShaders: (settings.customGlslShaders || []).map((s) =>
        s.id === id ? { ...s, enabled } : s,
      ),
    });
  };

  // --- Handlers for Scripts ---
  const handleAddScript = async () => {
    if (!isTauri) return;
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        multiple: true,
        directory: false,
        filters: [{ name: "mpv Script", extensions: ["lua", "js"] }],
      });

      if (!selected) return;
      const paths = Array.isArray(selected) ? selected : [selected];

      const newScripts: CustomFileItem[] = [];
      for (const p of paths) {
        const ext = p.split(".").pop()?.toLowerCase();
        if (ext !== "lua" && ext !== "js") {
          setErrorMessage(
            t("Invalid file format: '{name}'. Only .lua and .js script files are supported.", {
              name: p.split(/[/\\]/).pop() ?? p,
            }),
          );
          return;
        }
        const name = p.split(/[/\\]/).pop() || p;
        if (!(settings.customMpvScripts || []).some((s) => s.path === p)) {
          newScripts.push({
            id: `script-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
            name,
            path: p,
            enabled: true,
          });
        }
      }

      if (newScripts.length > 0) {
        update({
          customMpvScripts: [...(settings.customMpvScripts || []), ...newScripts],
        });
      }
    } catch (err) {
      setErrorMessage(String(err));
    }
  };

  const handleToggleScript = (id: string, enabled: boolean) => {
    update({
      customMpvScripts: (settings.customMpvScripts || []).map((s) =>
        s.id === id ? { ...s, enabled } : s,
      ),
    });
  };

  // Execute removal from app
  const confirmRemove = () => {
    if (!removingItem) return;
    const { item, type } = removingItem;
    if (type === "shader") {
      update({
        customGlslShaders: (settings.customGlslShaders || []).filter((s) => s.id !== item.id),
      });
    } else {
      update({
        customMpvScripts: (settings.customMpvScripts || []).filter((s) => s.id !== item.id),
      });
    }
    setRemovingItem(null);
    if (editingItem?.item.id === item.id) {
      setEditingItem(null);
    }
  };

  return (
    <div className="flex flex-col gap-10">
      {/* HTML5 Locked Notice Banner */}
      {isLocked && (
        <div className="flex items-start justify-between gap-4 rounded-xl border border-edge-soft/80 bg-elevated/70 p-4.5 shadow-sm backdrop-blur-sm">
          <div className="flex items-start gap-3.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface ring-1 ring-edge-soft text-ink-subtle">
              <Lock size={17} strokeWidth={2.4} />
            </div>
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <span className="text-[15px] font-semibold text-ink">
                  {t("Engine Directives & Scripts are locked")}
                </span>
                <span className="inline-flex items-center gap-1 rounded bg-accent/15 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-accent">
                  <Lock size={10} strokeWidth={2.5} />
                  {t("HTML5 Engine Active")}
                </span>
              </div>
              <p className="max-w-[68ch] text-[13.5px] leading-relaxed text-ink-muted">
                {t(
                  "Custom mpv options (mpv.conf), input keybindings (input.conf), GLSL shaders, and Lua scripts only run when using the native MPV engine. They have no effect while the player engine is set to HTML5.",
                )}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => update({ playerEngine: "mpv" })}
            className="shrink-0 rounded-[8px] bg-accent/20 px-3.5 py-2 text-[13px] font-semibold text-accent transition hover:bg-accent/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            {t("Switch to MPV")}
          </button>
        </div>
      )}

      {/* Error alert toast */}
      {errorMessage && (
        <div className="flex items-center justify-between rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-rose-300">
          <div className="flex items-center gap-2 text-[14px]">
            <AlertTriangle size={18} className="shrink-0 text-rose-400" />
            <span>{errorMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            className="rounded p-1 hover:bg-rose-500/20 text-rose-300"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* Main sections wrapper - greyed out and non-interactive when HTML5 is selected */}
      <div
        className={
          isLocked
            ? "relative flex flex-col gap-10 opacity-40 pointer-events-none select-none transition-opacity duration-200"
            : "flex flex-col gap-10"
        }
        aria-disabled={isLocked}
        inert={isLocked ? true : undefined}
      >
        {/* Caution & Redirect: Default HDR with mpv.conf and Shaders */}
        <div className="flex flex-col gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4.5 text-amber-200 shadow-sm backdrop-blur-sm">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/20 text-amber-400 ring-1 ring-amber-500/40">
                <AlertTriangle size={18} strokeWidth={2.4} />
              </div>
              <div className="flex flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[15px] font-semibold text-amber-100">
                    {t("Caution: HDR Configuration with Custom Directives & Shaders")}
                  </span>
                  {isDefaultHdr ? (
                    <span className="inline-flex items-center gap-1 rounded bg-emerald-500/20 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-emerald-300">
                      <Check size={11} strokeWidth={2.5} />
                      {t("Default HDR Active")}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded bg-amber-500/25 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-amber-300">
                      <AlertTriangle size={11} strokeWidth={2.5} />
                      {t("Override Active: {mode}", { mode: currentHdrLabel })}
                    </span>
                  )}
                </div>
                <p className="max-w-[76ch] text-[13.5px] leading-relaxed text-amber-200/90">
                  {t(
                    'When configuring custom HDR directives in mpv.conf (such as target-peak, tone-mapping, or inverse-tone-mapping) or loading custom GLSL shaders (such as HDR-Toys or custom tone-mappers), ensure your HDR mode is set to "Default" under Player & quality → Player engine rather than "Tonemap to SDR" or "True HDR". Harbor\'s built-in tonemapping and HDR window modes inject automated color management flags that will override, conflict with, or double-process your custom shaders and directives. Selecting "Default" lets vanilla mpv hand full, unhindered control to your custom configuration.',
                  )}
                </p>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2.5 pt-1 pl-[46px]">
            <button
              type="button"
              onClick={() => openPage("player", "engine")}
              className="inline-flex items-center gap-1.5 rounded-[8px] bg-amber-500/20 px-3.5 py-1.5 text-[13px] font-semibold text-amber-200 transition hover:bg-amber-500/30 hover:text-amber-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400"
            >
              <span>{t("Go to HDR Settings")}</span>
              <ArrowRight size={14} className="shrink-0" />
            </button>
            {!isDefaultHdr && (
              <button
                type="button"
                onClick={() =>
                  update({
                    playerHdrToSdr: false,
                    playerHdrOpaqueWindow: false,
                    playerHdrStage: "off",
                  })
                }
                className="inline-flex items-center gap-1.5 rounded-[8px] border border-amber-500/40 bg-canvas/60 px-3.5 py-1.5 text-[13px] font-semibold text-amber-200 transition hover:bg-canvas hover:text-amber-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400"
              >
                <Check size={14} className="shrink-0 text-emerald-400" />
                <span>{t("Switch HDR to Default Now")}</span>
              </button>
            )}
          </div>
        </div>

        {/* ------------------------------------------------------------- */}
        {/* 1. ENGINE DIRECTIVES (mpv.conf)                               */}
        {/* ------------------------------------------------------------- */}
        <Section
          title={t("Engine Directives (mpv.conf)")}
          subtitle={t(
            "Enter one mpv option per line, such as brightness=5. These override the video settings on other pages. Incorrect options can affect playback. Restart playback to apply changes.",
          )}
        >
          {isLocked && (
            <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-ink-subtle">
              <Lock size={13} strokeWidth={2.4} className="shrink-0 text-ink-subtle" />
              <span>{t("Available only when using the MPV video engine.")}</span>
            </div>
          )}
          <div className="relative flex flex-col">
            <textarea
              disabled={isLocked}
              value={settings.mpvExtraOptions || ""}
              onChange={(e) => update({ mpvExtraOptions: e.target.value })}
              spellCheck={false}
              rows={6}
              aria-label={t("Engine Directives (mpv.conf)")}
              placeholder={
                "tone-mapping=hable\ninverse-tone-mapping=yes\nbrightness=5\nsub-scale=1.2"
              }
              className="block w-full resize-y rounded-[10px] border border-edge-soft bg-elevated px-4 py-3 font-mono text-[14.5px] leading-[22px] text-ink outline-none placeholder:text-ink-subtle/55 focus-visible:border-edge focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            />
          </div>

          <p
            role="status"
            className="flex max-w-[70ch] flex-wrap items-center gap-x-4 gap-y-1 text-[14.5px] leading-[22px]"
          >
            {mpvCheck.valid > 0 && (
              <span className="font-medium text-emerald-400">
                {mpvCheck.valid === 1
                  ? t("1 option formatted correctly")
                  : t("{n} options formatted correctly", { n: mpvCheck.valid })}
              </span>
            )}
            {mpvCheck.skipped > 0 && (
              <span className="text-ink-subtle">
                {mpvCheck.skipped === 1
                  ? t("1 line skipped (unrecognized format or command)")
                  : t("{n} lines skipped (not valid)", { n: mpvCheck.skipped })}
              </span>
            )}
            {mpvCheck.valid === 0 && mpvCheck.skipped === 0 && (
              <span className="text-ink-subtle">
                {t("No custom options. Harbor uses your video settings.")}
              </span>
            )}
          </p>

          {mpvCheck.risky.length > 0 && (
            <RowNote>
              {t(
                "Heads up: {keys} can load outside scripts or open your player to the network. Only keep these if you know exactly what they do.",
                {
                  keys: mpvCheck.risky.join(", "),
                },
              )}
            </RowNote>
          )}

          {compiledMpv && (
            <div className="flex flex-col">
              <button
                type="button"
                onClick={() => setShowMpvCompiled((v) => !v)}
                aria-expanded={showMpvCompiled}
                className="flex min-h-11 w-fit items-center gap-2 text-start text-[14.5px] font-medium leading-[22px] text-ink-muted transition-colors hover:text-ink"
              >
                <ChevronDown
                  size={18}
                  className={`shrink-0 transition-transform duration-200 ${
                    showMpvCompiled ? "rotate-180" : ""
                  }`}
                />
                {t("View generated mpv options")}
              </button>
              {showMpvCompiled && (
                <pre className="mt-1.5 overflow-x-auto whitespace-pre-wrap rounded-[10px] bg-elevated px-4 py-3 font-mono text-[13.5px] leading-[20px] text-ink-muted border border-edge-soft/50">
                  {compiledMpv}
                </pre>
              )}
            </div>
          )}
        </Section>

        {/* ------------------------------------------------------------- */}
        {/* 2. INPUT CONFIGURATION (input.conf)                           */}
        {/* ------------------------------------------------------------- */}
        <Section
          title={t("Input Configuration (input.conf)")}
          subtitle={t(
            "Enter custom key bindings, one per line (e.g., SPACE cycle pause). Restarts required for changes.",
          )}
        >
          {isLocked && (
            <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-ink-subtle">
              <Lock size={13} strokeWidth={2.4} className="shrink-0 text-ink-subtle" />
              <span>{t("Available only when using the MPV video engine.")}</span>
            </div>
          )}
          <div className="relative flex flex-col">
            <textarea
              disabled={isLocked}
              value={settings.mpvInputConf || ""}
              onChange={(e) => update({ mpvInputConf: e.target.value })}
              spellCheck={false}
              rows={6}
              aria-label={t("Input Configuration (input.conf)")}
              placeholder={
                "RIGHT seek 5\nLEFT seek -5\nUP add volume 2\nDOWN add volume -2\nSPACE cycle pause\nm cycle mute"
              }
              className="block w-full resize-y rounded-[10px] border border-edge-soft bg-elevated px-4 py-3 font-mono text-[14.5px] leading-[22px] text-ink outline-none placeholder:text-ink-subtle/55 focus-visible:border-edge focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            />
          </div>

          <p
            role="status"
            className="flex max-w-[70ch] flex-wrap items-center gap-x-4 gap-y-1 text-[14.5px] leading-[22px]"
          >
            {inputCheck.valid > 0 && (
              <span className="font-medium text-emerald-400">
                {inputCheck.valid === 1
                  ? t("1 binding formatted correctly")
                  : t("{n} bindings formatted correctly", { n: inputCheck.valid })}
              </span>
            )}
            {inputCheck.skipped > 0 && (
              <span className="text-ink-subtle">
                {inputCheck.skipped === 1
                  ? t("1 line skipped (unrecognized format or command)")
                  : t("{n} lines skipped (unrecognized format or command)", {
                      n: inputCheck.skipped,
                    })}
              </span>
            )}
            {inputCheck.valid === 0 && inputCheck.skipped === 0 && (
              <span className="text-ink-subtle">
                {t("No custom bindings defined. Harbor uses default hotkeys.")}
              </span>
            )}
          </p>

          <div className="flex flex-col">
            <button
              type="button"
              onClick={() => setShowInputCompiled((v) => !v)}
              aria-expanded={showInputCompiled}
              className="flex min-h-11 w-fit items-center gap-2 text-start text-[14.5px] font-medium leading-[22px] text-ink-muted transition-colors hover:text-ink"
            >
              <ChevronDown
                size={18}
                className={`shrink-0 transition-transform duration-200 ${
                  showInputCompiled ? "rotate-180" : ""
                }`}
              />
              {t("View generated input options")}
            </button>
            {showInputCompiled && (
              <pre className="mt-1.5 overflow-x-auto whitespace-pre-wrap rounded-[10px] bg-elevated px-4 py-3 font-mono text-[13.5px] leading-[20px] text-ink-muted border border-edge-soft/50">
                {settings.mpvInputConf?.trim()
                  ? settings.mpvInputConf
                  : `# Example input configuration (input.conf):
SPACE cycle pause
RIGHT seek 5
UP add volume 2`}
              </pre>
            )}
          </div>
        </Section>

        {/* ------------------------------------------------------------- */}
        {/* 3. GLSL SHADERS                                               */}
        {/* ------------------------------------------------------------- */}
        <Section
          title={t("GLSL Shaders")}
          subtitle={t(
            "Add and manage custom GLSL shader paths, one per line. Use 'Add Shader' to browse.",
          )}
        >
          {isLocked && (
            <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-ink-subtle">
              <Lock size={13} strokeWidth={2.4} className="shrink-0 text-ink-subtle" />
              <span>{t("Available only when using the MPV video engine.")}</span>
            </div>
          )}
          <div className="flex flex-col gap-2 rounded-xl border border-edge-soft bg-elevated/60 p-3">
            {(settings.customGlslShaders || []).length === 0 ? (
              <div className="flex flex-col items-center justify-center py-6 text-center text-ink-subtle">
                <FileCode size={28} className="mb-2 opacity-40 text-ink-muted" />
                <p className="text-[13.5px]">{t("No custom GLSL shaders added yet.")}</p>
                <p className="text-[12px] opacity-75">
                  {t("Click '+ Add Shader' below to import your .glsl or .hook shaders.")}
                </p>
              </div>
            ) : (
              (settings.customGlslShaders || []).map((shader) => (
                <div
                  key={shader.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-edge-soft/60 bg-surface/80 px-3.5 py-2.5 transition-colors hover:border-edge"
                >
                  {/* Switch & Title */}
                  <div className="flex items-center gap-3 truncate">
                    {/* Native Harbor Toggle Switch */}
                    <button
                      type="button"
                      role="switch"
                      aria-checked={shader.enabled}
                      onClick={() => handleToggleShader(shader.id, !shader.enabled)}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${
                        shader.enabled ? "bg-accent" : "bg-surface ring-1 ring-edge-soft"
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ${
                          shader.enabled ? "translate-x-4" : "translate-x-0"
                        }`}
                      />
                    </button>

                    <div className="flex flex-col truncate" title={shader.path}>
                      <span className="font-mono text-[13.5px] font-semibold text-ink truncate">
                        {shader.name}
                      </span>
                      <span className="text-[11px] text-ink-subtle truncate max-w-[420px]">
                        {shader.path}
                      </span>
                    </div>
                  </div>

                  {/* Actions: Edit & Remove */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    {missingItemIds.has(shader.id) && (
                      <div
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-rose-500 bg-rose-500/10 cursor-help"
                        title={t(
                          "This shader file could not be found at its saved path. It may have been moved or deleted, causing mpv to fail to load it.",
                        )}
                      >
                        <AlertCircle size={15} className="shrink-0 text-rose-500" />
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => setEditingItem({ item: shader, type: "shader" })}
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-muted transition hover:bg-surface hover:text-ink"
                      title={t("Edit shader code")}
                    >
                      <Edit3 size={15} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setRemovingItem({ item: shader, type: "shader" })}
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-muted transition hover:bg-rose-500/20 hover:text-rose-400"
                      title={t("Remove shader from Harbor")}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              ))
            )}

            {/* Add Shader Button */}
            <div className="pt-1">
              <button
                type="button"
                onClick={handleAddShader}
                className="flex items-center gap-2 rounded-lg bg-surface/90 border border-edge px-3.5 py-2 text-[13px] font-semibold text-ink transition hover:bg-accent/15 hover:text-accent hover:border-accent/40"
              >
                <Plus size={15} strokeWidth={2.5} />
                <span>{t("Add Shader")}</span>
              </button>
            </div>
          </div>

          <div className="flex flex-col">
            <button
              type="button"
              onClick={() => setShowShaderCompiled((v) => !v)}
              aria-expanded={showShaderCompiled}
              className="flex min-h-11 w-fit items-center gap-2 text-start text-[14.5px] font-medium leading-[22px] text-ink-muted transition-colors hover:text-ink"
            >
              <ChevronDown
                size={18}
                className={`shrink-0 transition-transform duration-200 ${
                  showShaderCompiled ? "rotate-180" : ""
                }`}
              />
              {t("View generated shader options")}
            </button>
            {showShaderCompiled && (
              <pre className="mt-1.5 overflow-x-auto whitespace-pre-wrap rounded-[10px] bg-elevated px-4 py-3 font-mono text-[13.5px] leading-[20px] text-ink-muted border border-edge-soft/50">
                {customShadersMpvLines(settings) || t("# No custom shaders enabled")}
              </pre>
            )}
          </div>
        </Section>

        {/* ------------------------------------------------------------- */}
        {/* 4. LUA SCRIPTS                                                */}
        {/* ------------------------------------------------------------- */}
        <Section
          title={t("Lua Scripts")}
          subtitle={t(
            "Manage custom Lua scripts to extend player functionality. Scripts load when playback starts or restarts.",
          )}
        >
          {isLocked && (
            <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-ink-subtle">
              <Lock size={13} strokeWidth={2.4} className="shrink-0 text-ink-subtle" />
              <span>{t("Available only when using the MPV video engine.")}</span>
            </div>
          )}
          <div className="flex flex-col gap-2 rounded-xl border border-edge-soft bg-elevated/60 p-3">
            {(settings.customMpvScripts || []).length === 0 ? (
              <div className="flex flex-col items-center justify-center py-6 text-center text-ink-subtle">
                <FileCode size={28} className="mb-2 opacity-40 text-ink-muted" />
                <p className="text-[13.5px]">{t("No custom Lua scripts added yet.")}</p>
                <p className="text-[12px] opacity-75">
                  {t("Click '+ Add Script' below to import your .lua or .js player scripts.")}
                </p>
              </div>
            ) : (
              (settings.customMpvScripts || []).map((script) => (
                <div
                  key={script.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-edge-soft/60 bg-surface/80 px-3.5 py-2.5 transition-colors hover:border-edge"
                >
                  {/* Switch & Title */}
                  <div className="flex items-center gap-3 truncate">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={script.enabled}
                      onClick={() => handleToggleScript(script.id, !script.enabled)}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${
                        script.enabled ? "bg-accent" : "bg-surface ring-1 ring-edge-soft"
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ${
                          script.enabled ? "translate-x-4" : "translate-x-0"
                        }`}
                      />
                    </button>

                    <div className="flex flex-col truncate" title={script.path}>
                      <span className="font-mono text-[13.5px] font-semibold text-ink truncate">
                        {script.name}
                      </span>
                      <span className="text-[11px] text-ink-subtle truncate max-w-[420px]">
                        {script.path}
                      </span>
                    </div>
                  </div>

                  {/* Actions: Edit & Remove */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    {missingItemIds.has(script.id) && (
                      <div
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-rose-500 bg-rose-500/10 cursor-help"
                        title={t(
                          "This script file could not be found at its saved path. It may have been moved or deleted, causing mpv to fail to load it.",
                        )}
                      >
                        <AlertCircle size={15} className="shrink-0 text-rose-500" />
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => setEditingItem({ item: script, type: "script" })}
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-muted transition hover:bg-surface hover:text-ink"
                      title={t("Edit script code")}
                    >
                      <Edit3 size={15} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setRemovingItem({ item: script, type: "script" })}
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-muted transition hover:bg-rose-500/20 hover:text-rose-400"
                      title={t("Remove script from Harbor")}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              ))
            )}

            {/* Add Script Button */}
            <div className="pt-1">
              <button
                type="button"
                onClick={handleAddScript}
                className="flex items-center gap-2 rounded-lg bg-surface/90 border border-edge px-3.5 py-2 text-[13px] font-semibold text-ink transition hover:bg-accent/15 hover:text-accent hover:border-accent/40"
              >
                <Plus size={15} strokeWidth={2.5} />
                <span>{t("Add Script")}</span>
              </button>
            </div>
          </div>

          <div className="flex flex-col">
            <button
              type="button"
              onClick={() => setShowScriptCompiled((v) => !v)}
              aria-expanded={showScriptCompiled}
              className="flex min-h-11 w-fit items-center gap-2 text-start text-[14.5px] font-medium leading-[22px] text-ink-muted transition-colors hover:text-ink"
            >
              <ChevronDown
                size={18}
                className={`shrink-0 transition-transform duration-200 ${
                  showScriptCompiled ? "rotate-180" : ""
                }`}
              />
              {t("View generated script options")}
            </button>
            {showScriptCompiled && (
              <pre className="mt-1.5 overflow-x-auto whitespace-pre-wrap rounded-[10px] bg-elevated px-4 py-3 font-mono text-[13.5px] leading-[20px] text-ink-muted border border-edge-soft/50">
                {customScriptsMpvLines(settings) || t("# No custom scripts enabled")}
              </pre>
            )}
          </div>
        </Section>
      </div>

      {/* ------------------------------------------------------------- */}
      {/* CODE EDITOR MODAL                                             */}
      {/* ------------------------------------------------------------- */}
      {editingItem && (
        <CodeEditorModal
          item={editingItem.item}
          type={editingItem.type}
          hasActiveConfirmation={!!removingItem}
          onClose={() => setEditingItem(null)}
          onRemoveRequest={() => setRemovingItem(editingItem)}
        />
      )}

      {/* ------------------------------------------------------------- */}
      {/* REMOVAL CONFIRMATION MODAL                                    */}
      {/* ------------------------------------------------------------- */}
      {removingItem && (
        <RemovalConfirmationModal
          itemName={removingItem.item.name}
          onCancel={() => setRemovingItem(null)}
          onConfirm={confirmRemove}
        />
      )}
    </div>
  );
}

// -------------------------------------------------------------
// REMOVAL CONFIRMATION MODAL
// -------------------------------------------------------------
function RemovalConfirmationModal({
  itemName,
  onCancel,
  onConfirm,
}: {
  itemName: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const t = useT();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [onCancel]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[250] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-fade-in"
      onClick={onCancel}
    >
      <div
        className="flex w-full max-w-[420px] flex-col gap-4 rounded-2xl border border-edge-soft bg-canvas p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-500/15 text-rose-400">
            <Trash2 size={20} />
          </div>
          <div className="flex flex-col">
            <h3 className="text-[16px] font-bold text-ink">{t("Remove from Harbor?")}</h3>
            <span className="text-[12px] text-ink-muted truncate max-w-[280px]">{itemName}</span>
          </div>
        </div>

        <p className="text-[13.5px] leading-relaxed text-ink-muted">
          {t(
            "This will remove the file reference from Harbor's settings. The real file on your disk will remain completely untouched.",
          )}
        </p>

        <div className="flex items-center justify-end gap-2.5 pt-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-xl px-4 py-2 text-[13.5px] font-medium text-ink-muted transition hover:bg-surface hover:text-ink"
          >
            {t("Cancel")}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-xl bg-rose-500 px-4 py-2 text-[13.5px] font-semibold text-white transition hover:bg-rose-600 shadow-md"
          >
            {t("Remove")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// -------------------------------------------------------------
// DEDICATED CODE EDITOR MODAL (With Syntax Highlighting & Real File Save)
// -------------------------------------------------------------
function CodeEditorModal({
  item,
  type,
  onClose,
  onRemoveRequest,
  hasActiveConfirmation,
}: {
  item: CustomFileItem;
  type: "shader" | "script";
  onClose: () => void;
  onRemoveRequest: () => void;
  hasActiveConfirmation?: boolean;
}) {
  const t = useT();
  const [code, setCode] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedFeedback, setSavedFeedback] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Load code from disk
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        setLoading(true);
        const { readTextFile } = await import("@tauri-apps/plugin-fs");
        const content = await readTextFile(item.path);
        if (!cancelled) {
          setCode(content);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(t("Failed to read file from disk: {err}", { err: String(err) }));
          setLoading(false);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [item.path, t]);

  // Save code to disk
  const handleSave = async () => {
    if (saving || loading || error !== null) return;
    try {
      setSaving(true);
      const { writeTextFile } = await import("@tauri-apps/plugin-fs");
      await writeTextFile(item.path, code);
      setSaving(false);
      setSavedFeedback(true);
      setTimeout(() => setSavedFeedback(false), 2000);
    } catch (err) {
      setSaving(false);
      setError(t("Failed to save changes to disk: {err}", { err: String(err) }));
    }
  };

  // Keyboard shortcut Ctrl+S / Cmd+S
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void handleSave();
      } else if (e.key === "Escape") {
        if (hasActiveConfirmation) return;
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [code, saving, loading, error, hasActiveConfirmation, onClose, t]);

  const handleCopyPath = async () => {
    try {
      await navigator.clipboard.writeText(item.path);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  // Line count
  const lines = code.split("\n");

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[250] flex items-center justify-center bg-black/75 backdrop-blur-md p-4 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="flex w-full max-w-[840px] h-[600px] max-h-[88vh] flex-col rounded-2xl border border-edge bg-canvas shadow-2xl overflow-hidden font-mono select-none"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Title Bar */}
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-edge-soft/70 px-4 bg-surface/50">
          {/* File Name & Format */}
          <div className="flex items-center gap-2 truncate">
            <FileCode size={17} className="text-accent shrink-0" />
            <span className="font-bold text-[13.5px] text-ink truncate">{item.name}</span>
            <span className="rounded bg-accent/20 px-1.5 py-0.5 text-[9px] font-bold uppercase text-accent shrink-0">
              {type === "shader" ? "GLSL" : "LUA"}
            </span>
          </div>

          {/* Center Path Box with Copy Button */}
          <div className="mx-4 flex max-w-[360px] flex-1 items-center justify-between rounded-lg border border-edge-soft/60 bg-surface px-2.5 py-1 text-[11px] text-ink-muted">
            <span className="truncate pr-2" title={item.path}>
              {item.path}
            </span>
            <button
              type="button"
              onClick={handleCopyPath}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-ink-subtle transition hover:bg-surface-elevated hover:text-ink shrink-0"
              title={t("Copy path")}
            >
              {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
              <span>{copied ? t("Copied") : t("Copy")}</span>
            </button>
          </div>

          {/* Right Actions: Remove & Close */}
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={onRemoveRequest}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-subtle transition hover:bg-rose-500/20 hover:text-rose-400"
              title={t("Remove file from Harbor")}
            >
              <Trash2 size={16} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-subtle transition hover:bg-surface hover:text-ink"
              aria-label={t("Close editor")}
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Editor Body */}
        <div className="relative flex flex-1 overflow-hidden bg-[#0d0f12]">
          {loading ? (
            <div className="flex h-full w-full items-center justify-center text-ink-subtle text-[13px]">
              {t("Loading file from disk...")}
            </div>
          ) : error ? (
            <div className="flex h-full w-full items-center justify-center p-6 text-center text-rose-400 text-[13px]">
              {error}
            </div>
          ) : (
            <div className="flex h-full w-full overflow-hidden select-text">
              {/* Line Numbers Gutter */}
              <div
                aria-hidden="true"
                className="flex w-12 shrink-0 flex-col overflow-hidden bg-[#0a0c0e] py-3 text-right pr-3 font-mono text-[12px] leading-[20px] text-ink-subtle/40 select-none border-r border-edge-soft/20"
              >
                {lines.map((_, i) => (
                  <span key={i}>{i + 1}</span>
                ))}
              </div>

              {/* Text Area */}
              <textarea
                ref={textareaRef}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                spellCheck={false}
                className="flex-1 resize-none bg-transparent p-3 font-mono text-[12.5px] leading-[20px] text-ink outline-none selection:bg-accent/30"
              />
            </div>
          )}
        </div>

        {/* Footer Bar */}
        <div className="flex h-11 shrink-0 items-center justify-between border-t border-edge-soft/70 px-4 bg-surface/40 text-[11px] text-ink-subtle">
          <div className="flex items-center gap-3">
            <span>
              {lines.length} {t("lines")} · {code.length} {t("chars")}
            </span>
            <span className="hidden sm:inline text-ink-subtle/70">
              {t("Edits write directly to the real file on disk.")}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {savedFeedback && (
              <span className="flex items-center gap-1 font-bold text-emerald-400">
                <Check size={13} strokeWidth={3} />
                {t("Saved to disk")}
              </span>
            )}
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || loading || !!error}
              className="flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-1.5 font-sans text-[12px] font-semibold text-black transition hover:bg-accent/90 disabled:opacity-50"
            >
              <span>{saving ? t("Saving...") : t("Save (Ctrl+S)")}</span>
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
