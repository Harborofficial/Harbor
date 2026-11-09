import type { Settings } from "@/lib/settings";
import { bufferMpvLines, bufferSizeFor } from "./buffer-profile";

const QUALITY_LINES: Record<Settings["mpvQuality"], string[]> = {
  balanced: [],
  performance: [
    "scale=bilinear",
    "cscale=bilinear",
    "dscale=bilinear",
    "dither=no",
    "deband=no",
    "vd-lavc-fast=yes",
    "interpolation=no",
    "hdr-compute-peak=no",
  ],
  quality: [
    "scale=ewa_lanczossharp",
    "cscale=ewa_lanczossharp",
    "dscale=mitchell",
    "deband=yes",
    "deband-iterations=2",
    "dither-depth=auto",
    "correct-downscaling=yes",
    "linear-downscaling=yes",
    "sigmoid-upscaling=yes",
    "hdr-compute-peak=yes",
  ],
};

export function compileMpvOptions(
  s: Settings,
  opts?: { anime4k?: boolean; totalPhysBytes?: number },
): string {
  const lines: string[] = [...(QUALITY_LINES[s.mpvQuality] ?? [])];
  if (opts?.anime4k) {
    // mpv runs `scale` after the user shaders, so a bilinear kernel here would
    // undo the upscale Anime4K just performed. Only the bilinear kernels are
    // dropped; the sharp lanczos ones still help and stay on.
    const kept = lines.filter((l) => !/^(scale|cscale|dscale)=bilinear$/.test(l));
    lines.length = 0;
    lines.push(...kept);
  }
  if (s.mpvHwdec === "on") lines.push("hwdec=yes");
  else if (s.mpvHwdec === "off") lines.push("hwdec=no");
  lines.push(...bufferMpvLines(bufferSizeFor(s), opts?.totalPhysBytes));
  if (s.mpvDownmixStereo) lines.push("audio-channels=stereo");
  if (s.audioDevice && s.audioDevice !== "auto") lines.push(`audio-device=${s.audioDevice}`);
  if (s.playerDisplayPanel === "oled" && s.playerHdrToSdr) lines.push("target-contrast=inf");
  for (const [k, v] of Object.entries(s.mpvTweaks ?? {})) {
    if (v !== "" && v != null) lines.push(`${k}=${v}`);
  }
  return lines.join("\n");
}

export function svpMpvLines(s: Settings, svpActive: boolean): string {
  if (!svpActive || !s.svpVpyPath) return "";
  const vpy = s.svpVpyPath.replace(/\\/g, "/");
  return [`vf=@harbor-svp:vapoursynth=[${vpy}]`, "hwdec=auto-copy", "hr-seek-framedrop=no"].join(
    "\n",
  );
}

export function customShadersMpvLines(s: Settings): string {
  const enabled = (s.customGlslShaders || []).filter((sh) => sh.enabled && sh.path?.trim());
  if (enabled.length === 0) return "";
  const paths = enabled.map((sh) => sh.path.replace(/\\/g, "/")).join(";");
  return `glsl-shaders=${paths}`;
}

export function customScriptsMpvLines(s: Settings): string {
  const enabled = (s.customMpvScripts || []).filter((sc) => sc.enabled && sc.path?.trim());
  if (enabled.length === 0) return "";
  const lines = [
    "load-scripts=yes",
    ...enabled.map((sc) => `load-script=${sc.path.replace(/\\/g, "/")}`),
  ];
  return lines.join("\n");
}

export function mergeMpvOptions(
  s: Settings,
  svpActive: boolean,
  opts?: { anime4k?: boolean; totalPhysBytes?: number },
): string | undefined {
  const merged = [
    compileMpvOptions(s, opts),
    svpMpvLines(s, svpActive),
    customScriptsMpvLines(s),
    s.mpvExtraOptions || "",
  ]
    .filter((p) => p.trim())
    .join("\n");
  return merged.trim() ? merged : undefined;
}

const RISKY =
  /^(scripts?|load-script|input-ipc-server|input-conf|input-cmdlist|ytdl-raw-options)$/i;

export type MpvLineCheck = { valid: number; skipped: number; risky: string[] };

/**
 * Keys the user set explicitly in Advanced (mpv.conf). Harbor still owns every
 * playback property it writes at runtime, except these: the panel promises the
 * user's values override Harbor's settings, so runtime passes must not reset
 * them.
 */
export function mpvExtraOptionKeys(raw: string | undefined | null): Set<string> {
  const keys = new Set<string>();
  for (const line of (raw ?? "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("//")) continue;
    const body = (trimmed.startsWith("--") ? trimmed.slice(2) : trimmed).trim();
    const withValue = body.includes("=") ? body.split("=", 1)[0] : body.split(/\s+/, 1)[0];
    const key = withValue.trim().toLowerCase();
    if (!key || key === "log-file" || key === "terminal") continue;
    keys.add(key);
  }
  return keys;
}

/** Visual subtitle options require libmpv to draw subtitles instead of the HTML overlay. */
export function hasCustomMpvSubtitleStyle(raw: string | undefined | null): boolean {
  return [...mpvExtraOptionKeys(raw)].some((key) =>
    /^(?:sub-(?:font(?:-.*)?|color|border(?:-.*)?|outline(?:-.*)?|shadow(?:-.*)?|back(?:-.*)?|spacing|line-spacing|margin-[xy]|pos|align-[xy]|use-margins|ass-override|scale|bold|italic|blur|justify)|ass-line-spacing)$/.test(
      key,
    ),
  );
}

export function validateMpvOptions(raw: string): MpvLineCheck {
  let valid = 0;
  let skipped = 0;
  const risky: string[] = [];
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const body = t.replace(/^--/, "");
    const key = body.split("=")[0].trim();
    if (/^[a-z0-9-]+(=.*)?$/i.test(body) && key) {
      valid++;
      if (RISKY.test(key)) risky.push(key);
    } else {
      skipped++;
    }
  }
  return { valid, skipped, risky };
}

export const KNOWN_MPV_COMMANDS = new Set([
  "seek",
  "revert-seek",
  "quit",
  "quit-watch-later",
  "stop",
  "frame-step",
  "frame-back-step",
  "playlist-next",
  "playlist-prev",
  "playlist-clear",
  "playlist-remove",
  "playlist-move",
  "playlist-shuffle",
  "sub-step",
  "sub-seek",
  "sub-reload",
  "sub-remove",
  "sub-add",
  "audio-add",
  "print-text",
  "show-text",
  "show-progress",
  "rescan-external-files",
  "screenshot",
  "screenshot-to-file",
  "screenshot-raw",
  "loadfile",
  "loadlist",
  "run",
  "set",
  "add",
  "cycle",
  "multiply",
  "cycle-values",
  "enable-section",
  "disable-section",
  "define-section",
  "ab-loop",
  "drop-buffers",
  "script-binding",
  "script-message",
  "script-message-to",
  "hook-add",
  "hook-ack",
  "keypress",
  "keydown",
  "keyup",
  "apply-profile",
  "load-script",
  "script-reload",
  "change-list",
  "ignore",
  "write-watch-later-config",
  "dump-cache",
  "osd-msg1",
  "osd-msg2",
  "osd-msg3",
  "osd-auto",
]);

export const MPV_KEY_PATTERN =
  /^(?:(?:ctrl|alt|shift|meta)\+)*(?:[a-z0-9_+\-.,/\\`~=[\]';<>?:"{}!@#$%^&*()]|f\d+|kp\d+|kp_[a-z]+|mbtn_[a-z]+|wheel_[a-z]+|space|enter|tab|bs|del|ins|home|end|pgup|pgdwn|esc|right|left|up|down|sharp)$/i;

export type InputConfCheck = { valid: number; skipped: number };

export function validateInputConf(raw: string): InputConfCheck {
  let valid = 0;
  let skipped = 0;
  for (const rawLine of raw.split("\n")) {
    let t = rawLine.trim();
    if (!t || t.startsWith("#")) continue;
    // Strip optional section prefix e.g. {section} and input flags
    t = t
      .replace(/^\{[^}]+\}\s+/, "")
      .replace(/^(?:repeatable|non-repeatable)\s+/i, "")
      .trim();
    // Input conf format: <KEY> <COMMAND> [ARGS...]
    const m = t.match(/^([^\s#]+)\s+([^#]+)/);
    if (!m || !m[1] || !m[2]?.trim()) {
      skipped++;
      continue;
    }

    const keyToken = m[1].trim();
    const commandPart = m[2].trim();

    // Check key format
    if (!MPV_KEY_PATTERN.test(keyToken)) {
      skipped++;
      continue;
    }

    // Extract first command token, ignoring mpv command prefixes like repeatable, sync, etc.
    const tokens = commandPart.split(/\s+/).filter(Boolean);
    let cmdIdx = 0;
    while (
      cmdIdx < tokens.length &&
      /^(?:repeatable|non-repeatable|sync|async|raw)$/i.test(tokens[cmdIdx])
    ) {
      cmdIdx++;
    }

    if (cmdIdx >= tokens.length) {
      skipped++;
      continue;
    }

    const firstCmd = tokens[cmdIdx].toLowerCase();
    // Support compound commands separated by semicolon (e.g. cycle pause; show-text "\")
    const baseCmd = firstCmd.split(";")[0].trim();

    if (KNOWN_MPV_COMMANDS.has(baseCmd)) {
      valid++;
    } else {
      skipped++;
    }
  }
  return { valid, skipped };
}
