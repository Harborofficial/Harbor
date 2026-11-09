export type HotkeyScope = "Player" | "Global" | "Manga";

export type HotkeyId =
  | "playerClose"
  | "playerPlayPause"
  | "playerSeekBack10"
  | "playerSeekForward10"
  | "playerSeekBackShort"
  | "playerSeekForwardShort"
  | "playerSeekBack30"
  | "playerSeekForward30"
  | "playerFrameBack"
  | "playerFrameForward"
  | "playerVolumeUp"
  | "playerVolumeDown"
  | "playerMute"
  | "playerFullscreen"
  | "playerPip"
  | "playerSubtitleCycle"
  | "playerSubtitleCycleAlt"
  | "playerNextEpisode"
  | "playerPrevEpisode"
  | "playerPrevChannel"
  | "playerStart"
  | "playerEnd"
  | "playerStats"
  | "playerAnime4kToggle"
  | "playerAnime4kOn"
  | "playerAnime4kOff"
  | "playerRtxHdrToggle"
  | "playerRtxVsrToggle"
  | "playerCrop"
  | "playerPanscanUp"
  | "playerPanscanDown"
  | "playerScreenshot"
  | "playerGifRecord"
  | "playerClipRecord"
  | "playerSpeedDown"
  | "playerSpeedUp"
  | "playerSubDelayDown"
  | "playerSubDelayUp"
  | "playerStreamSwitcher"
  | "playerEpisodePanel"
  | "playerTvGuide"
  | "playerDvr"
  | "playerSleep"
  | "playerScreenLock"
  | "playerReloadSource"
  | "playerRestartServer"
  | "globalUiScaleUp"
  | "globalUiScaleDown"
  | "globalUiScaleReset"
  | "globalSearchFocus"
  | "globalSettingsOpen"
  | "mangaMatch";

export type HotkeyDef = {
  id: HotkeyId;
  scope: HotkeyScope;
  label: string;
  description: string;
  defaultBinding: string;
  group?: string;
};

export const HOTKEYS: HotkeyDef[] = [
  {
    id: "globalSearchFocus",
    scope: "Global",
    group: "Navigation",
    label: "Focus search",
    description: "Jump to the top-bar search from anywhere.",
    defaultBinding: "/",
  },
  {
    id: "globalSettingsOpen",
    scope: "Global",
    group: "Navigation",
    label: "Open settings",
    description: "Open Harbor's settings outside playback.",
    defaultBinding: "ctrl+s",
  },
  {
    id: "globalUiScaleUp",
    scope: "Global",
    group: "Interface",
    label: "Increase interface scale",
    description: "Make Harbor's interface larger.",
    defaultBinding: "ctrl+=",
  },
  {
    id: "globalUiScaleDown",
    scope: "Global",
    group: "Interface",
    label: "Decrease interface scale",
    description: "Make Harbor's interface smaller.",
    defaultBinding: "ctrl+-",
  },
  {
    id: "globalUiScaleReset",
    scope: "Global",
    group: "Interface",
    label: "Reset interface scale",
    description: "Restore Harbor's interface scale to 100%.",
    defaultBinding: "ctrl+0",
  },

  {
    id: "playerClose",
    scope: "Player",
    group: "Playback",
    label: "Close player",
    description: "Exit playback and return to the previous view.",
    defaultBinding: "Escape",
  },
  {
    id: "playerPlayPause",
    scope: "Player",
    group: "Playback",
    label: "Play / pause",
    description: "Toggle playback.",
    defaultBinding: "Space",
  },
  {
    id: "playerFullscreen",
    scope: "Player",
    group: "Playback",
    label: "Toggle fullscreen",
    description: "Enter or exit fullscreen.",
    defaultBinding: "f",
  },
  {
    id: "playerPip",
    scope: "Player",
    group: "Playback",
    label: "Picture-in-picture",
    description: "Pop the video into a small always-on-top window, or restore it.",
    defaultBinding: "u",
  },
  {
    id: "playerScreenLock",
    scope: "Player",
    group: "Playback",
    label: "Lock player controls",
    description: "Block mouse and keyboard input until you unlock the player.",
    defaultBinding: "ctrl+l",
  },
  {
    id: "playerStats",
    scope: "Player",
    group: "Playback",
    label: "Toggle stats overlay",
    description: "Show or hide the playback stats overlay.",
    defaultBinding: "i",
  },
  {
    id: "playerCrop",
    scope: "Player",
    group: "Playback",
    label: "Cycle aspect / crop",
    description: "Cycle aspect and crop modes: Fit, Fill, Zoom, 16:9, 4:3, Original.",
    defaultBinding: "v",
  },
  {
    id: "playerPanscanDown",
    scope: "Player",
    group: "Playback",
    label: "Zoom out",
    description: "Step zoom out to restore baked-in black bars (Zoom mode).",
    defaultBinding: "-",
  },
  {
    id: "playerPanscanUp",
    scope: "Player",
    group: "Playback",
    label: "Zoom in",
    description: "Step zoom in to crop baked-in black bars (Zoom mode).",
    defaultBinding: "=",
  },
  {
    id: "playerScreenshot",
    scope: "Player",
    group: "Playback",
    label: "Screenshot",
    description: "Save the current frame (video only, no subtitles) as a PNG to Pictures/Harbor.",
    defaultBinding: "p",
  },
  {
    id: "playerGifRecord",
    scope: "Player",
    group: "Playback",
    label: "Record GIF",
    description:
      "Start or stop recording a GIF of the video (no subtitles). Saves to Pictures/Harbor.",
    defaultBinding: "o",
  },
  {
    id: "playerClipRecord",
    scope: "Player",
    group: "Playback",
    label: "Save video clip",
    description:
      "Save the last 30 seconds as a video clip with audio, choosing subtitles on or off. Saves to Pictures/Harbor.",
    defaultBinding: "c",
  },
  {
    id: "playerAnime4kToggle",
    scope: "Player",
    group: "Playback",
    label: "Toggle Anime4K",
    description: "Turn Anime4K upscaling on (auto) or off. Only active when shaders are available.",
    defaultBinding: "a",
  },
  {
    id: "playerAnime4kOn",
    scope: "Player",
    group: "Playback",
    label: "Anime4K on",
    description: "Turn Anime4K upscaling on. Only active when shaders are available.",
    defaultBinding: "ctrl+1",
  },
  {
    id: "playerAnime4kOff",
    scope: "Player",
    group: "Playback",
    label: "Anime4K off",
    description: "Turn Anime4K upscaling off.",
    defaultBinding: "ctrl+0",
  },
  {
    id: "playerRtxHdrToggle",
    scope: "Player",
    group: "Playback",
    label: "Toggle RTX Video HDR",
    description:
      "Toggle RTX Video HDR during mpv playback. Unavailable while HDR-to-SDR tonemapping or SVP is active.",
    defaultBinding: "ctrl+h",
  },
  {
    id: "playerRtxVsrToggle",
    scope: "Player",
    group: "Playback",
    label: "Toggle RTX Super Resolution",
    description:
      "Toggle RTX Video Super Resolution during mpv playback. Unavailable while SVP is active.",
    defaultBinding: "ctrl+u",
  },

  {
    id: "playerSeekBack10",
    scope: "Player",
    group: "Seeking",
    label: "Seek back",
    description: "Jump back by the Back seek step set under Behavior.",
    defaultBinding: "ArrowLeft",
  },
  {
    id: "playerSeekForward10",
    scope: "Player",
    group: "Seeking",
    label: "Seek forward",
    description: "Jump forward by the Forward seek step set under Behavior.",
    defaultBinding: "ArrowRight",
  },
  {
    id: "playerSeekBackShort",
    scope: "Player",
    group: "Seeking",
    label: "Short seek back",
    description: "Jump back by the shorter Short seek step set under Behavior.",
    defaultBinding: "shift+ArrowLeft",
  },
  {
    id: "playerSeekForwardShort",
    scope: "Player",
    group: "Seeking",
    label: "Short seek forward",
    description: "Jump forward by the shorter Short seek step set under Behavior.",
    defaultBinding: "shift+ArrowRight",
  },
  {
    id: "playerSeekBack30",
    scope: "Player",
    group: "Seeking",
    label: "Seek back 30s",
    description: "Jump back thirty seconds.",
    defaultBinding: ",",
  },
  {
    id: "playerSeekForward30",
    scope: "Player",
    group: "Seeking",
    label: "Seek forward 30s",
    description: "Jump forward thirty seconds.",
    defaultBinding: ".",
  },
  {
    id: "playerFrameBack",
    scope: "Player",
    group: "Seeking",
    label: "Previous frame",
    description: "Step back one frame and pause. Frame-accurate on mpv.",
    defaultBinding: "shift+<",
  },
  {
    id: "playerFrameForward",
    scope: "Player",
    group: "Seeking",
    label: "Next frame",
    description: "Step forward one frame and pause. Frame-accurate on mpv.",
    defaultBinding: "shift+>",
  },
  {
    id: "playerStart",
    scope: "Player",
    group: "Seeking",
    label: "Jump to start",
    description: "Seek to the beginning.",
    defaultBinding: "Home",
  },
  {
    id: "playerEnd",
    scope: "Player",
    group: "Seeking",
    label: "Jump to end",
    description: "Seek to the last half second.",
    defaultBinding: "End",
  },

  {
    id: "playerVolumeUp",
    scope: "Player",
    group: "Volume",
    label: "Volume up",
    description: "Raise volume (hold Shift for big steps).",
    defaultBinding: "ArrowUp",
  },
  {
    id: "playerVolumeDown",
    scope: "Player",
    group: "Volume",
    label: "Volume down",
    description: "Lower volume (hold Shift for big steps).",
    defaultBinding: "ArrowDown",
  },
  {
    id: "playerMute",
    scope: "Player",
    group: "Volume",
    label: "Toggle mute",
    description: "Mute or unmute audio.",
    defaultBinding: "m",
  },

  {
    id: "playerSubtitleCycle",
    scope: "Player",
    group: "Tracks",
    label: "Cycle subtitles",
    description: "Cycle through available subtitle tracks.",
    defaultBinding: "s",
  },
  {
    id: "playerSubtitleCycleAlt",
    scope: "Player",
    group: "Tracks",
    label: "Cycle subtitles (alt)",
    description: "A second binding for the same action so muscle memory survives.",
    defaultBinding: "c",
  },
  {
    id: "playerSubDelayDown",
    scope: "Player",
    group: "Tracks",
    label: "Subtitle delay −0.1s",
    description: "Shift subtitle timing earlier (Shift for fine steps).",
    defaultBinding: "z",
  },
  {
    id: "playerSubDelayUp",
    scope: "Player",
    group: "Tracks",
    label: "Subtitle delay +0.1s",
    description: "Shift subtitle timing later (Shift for fine steps).",
    defaultBinding: "x",
  },

  {
    id: "playerNextEpisode",
    scope: "Player",
    group: "Navigation",
    label: "Next episode",
    description: "Skip to the next episode if available.",
    defaultBinding: "n",
  },
  {
    id: "playerPrevEpisode",
    scope: "Player",
    group: "Navigation",
    label: "Previous episode",
    description: "Skip to the previous episode if available.",
    defaultBinding: "b",
  },
  {
    id: "playerPrevChannel",
    scope: "Player",
    group: "Navigation",
    label: "Previous channel",
    description: "Jump back to the last live channel you watched (live TV only).",
    defaultBinding: "h",
  },

  {
    id: "playerSpeedDown",
    scope: "Player",
    group: "Speed",
    label: "Speed down",
    description: "Slow playback by 0.25x.",
    defaultBinding: "[",
  },
  {
    id: "playerSpeedUp",
    scope: "Player",
    group: "Speed",
    label: "Speed up",
    description: "Speed playback up by 0.25x.",
    defaultBinding: "]",
  },

  {
    id: "playerStreamSwitcher",
    scope: "Player",
    group: "Panels",
    label: "Stream switcher",
    description: "Open or close the in-player stream switcher.",
    defaultBinding: "w",
  },
  {
    id: "playerEpisodePanel",
    scope: "Player",
    group: "Panels",
    label: "Up next / episodes",
    description: "Open or close the episode panel.",
    defaultBinding: "e",
  },
  {
    id: "playerTvGuide",
    scope: "Player",
    group: "Panels",
    label: "TV guide",
    description: "Open or close the live TV guide (live channels only).",
    defaultBinding: "g",
  },
  {
    id: "playerDvr",
    scope: "Player",
    group: "Panels",
    label: "DVR / record",
    description: "Open or close the live TV recorder (live channels only).",
    defaultBinding: "r",
  },
  {
    id: "playerSleep",
    scope: "Player",
    group: "Panels",
    label: "Sleep at end of episode",
    description: "Toggle a sleep timer that pauses when this episode ends.",
    defaultBinding: "l",
  },

  {
    id: "playerReloadSource",
    scope: "Player",
    group: "Recovery",
    label: "Reload source",
    description: "Re-open the stream you are watching and pick it back up where you left off.",
    defaultBinding: "ctrl+alt+r",
  },
  {
    id: "playerRestartServer",
    scope: "Player",
    group: "Recovery",
    label: "Restart streaming server",
    description:
      "Restart Harbor's own streaming server, then reload the stream once it is back. Desktop only.",
    defaultBinding: "ctrl+alt+s",
  },

  {
    id: "mangaMatch",
    scope: "Manga",
    group: "Reader",
    label: "Manga match",
    description: "Open the match picker to map the current manga to AniList or MyAnimeList.",
    defaultBinding: "c",
  },
];

export const HOTKEY_MAP: Record<HotkeyId, HotkeyDef> = Object.fromEntries(
  HOTKEYS.map((h) => [h.id, h]),
) as Record<HotkeyId, HotkeyDef>;

function bindingForKey(
  key: string,
  modifiers: { ctrl: boolean; shift: boolean; alt: boolean; meta: boolean },
): string {
  const mods: string[] = [];
  const isLetter = key.length === 1 && /[a-zA-Z]/.test(key);
  if (modifiers.ctrl) mods.push("ctrl");
  if (modifiers.shift && !isLetter) mods.push("shift");
  if (modifiers.alt) mods.push("alt");
  if (modifiers.meta) mods.push("meta");
  if (key === " ") key = "Space";
  if (isLetter) key = key.toLowerCase();
  return mods.length === 0 ? key : mods.join("+") + "+" + key;
}

export function eventToBinding(e: KeyboardEvent): string {
  return bindingForKey(e.key, {
    ctrl: e.ctrlKey,
    shift: e.shiftKey,
    alt: e.altKey,
    meta: e.metaKey,
  });
}

export function isModifierOnly(e: KeyboardEvent): boolean {
  return e.key === "Shift" || e.key === "Control" || e.key === "Alt" || e.key === "Meta";
}

export function isTypingTarget(e: KeyboardEvent): boolean {
  const node = (e.target ??
    (typeof document === "undefined" ? null : document.activeElement)) as HTMLElement | null;
  if (!node || node.nodeType !== 1) return false;
  const tag = node.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (node.isContentEditable) return true;
  const role = node.getAttribute("role");
  return role === "textbox" || role === "searchbox" || role === "combobox";
}

export function shouldHandleGlobalKeyboardEvent(e: KeyboardEvent): boolean {
  if (typeof document !== "undefined" && !document.hasFocus()) return false;
  return !e.isComposing && e.key !== "Process" && !isTypingTarget(e);
}

function bindingOverride(id: HotkeyId, overrides: Record<string, string>): string | undefined {
  const override = overrides[id];
  return typeof override === "string" && override.length > 0 ? override : undefined;
}

export function effectiveBinding(id: HotkeyId, overrides: Record<string, string>): string {
  return bindingOverride(id, overrides) ?? HOTKEY_MAP[id].defaultBinding;
}

export function formatBindingForDisplay(binding: string): string {
  return binding
    .split("+")
    .map((p) => {
      if (p === "ctrl") return "Ctrl";
      if (p === "shift") return "Shift";
      if (p === "alt") return "Alt";
      if (p === "meta") return "⌘";
      if (p === " ") return "Space";
      if (p === "ArrowUp") return "↑";
      if (p === "ArrowDown") return "↓";
      if (p === "ArrowLeft") return "←";
      if (p === "ArrowRight") return "→";
      if (p.length === 1) return p.toUpperCase();
      return p;
    })
    .join(" + ");
}

export function isPlayerHotkeyTarget(e: KeyboardEvent): boolean {
  const player = document.querySelector("[data-harbor-player]");
  if (!player || player.getAttribute("data-detached") === "true") return false;
  return player.getAttribute("data-docked") !== "true" || e.composedPath().includes(player);
}

function isActiveLocalHotkeyScope(e: KeyboardEvent, scope: HotkeyScope): boolean {
  if (typeof document === "undefined") return false;
  if (scope === "Player") return isPlayerHotkeyTarget(e);
  return scope === "Manga" && document.querySelector("[data-harbor-manga-reader]") !== null;
}

const US_PUNCTUATION_BY_CODE: Record<string, readonly [string, string]> = {
  Backquote: ["`", "~"],
  Minus: ["-", "_"],
  Equal: ["=", "+"],
  BracketLeft: ["[", "{"],
  BracketRight: ["]", "}"],
  Backslash: ["\\", "|"],
  IntlBackslash: ["\\", "|"],
  Semicolon: [";", ":"],
  Quote: ["'", '"'],
  Comma: [",", "<"],
  Period: [".", ">"],
  Slash: ["/", "?"],
};

function defaultBindingFallbacks(e: KeyboardEvent): string[] {
  if (e.isComposing) return [];

  const altGraph = e.getModifierState?.("AltGraph") === true;
  const modifiers = {
    ctrl: altGraph ? false : e.ctrlKey,
    alt: altGraph ? false : e.altKey,
    meta: e.metaKey,
  };
  const fallbacks = new Set<string>();
  const add = (key: string, shift: boolean) => {
    fallbacks.add(bindingForKey(key, { ...modifiers, shift }));
  };

  // A layout can require Shift or AltGr for a character. Try both Shift states
  // so punctuation defaults such as "shift+<" still match where "<" is
  // unshifted, and digits match where the number row needs Shift.
  if (e.key.length === 1 && /^[\p{P}\p{S}\p{N}]$/u.test(e.key)) {
    add(e.key, false);
    add(e.key, true);
  }

  // Map non-ASCII digits back to their physical number-row digit.
  const digit = /^(?:Digit|Numpad)([0-9])$/.exec(e.code);
  if (digit && /^\p{Nd}$/u.test(e.key)) {
    add(digit[1], false);
    add(digit[1], true);
  }

  // A non-ASCII key still sits on a physical key. Fall back to what that key
  // would produce on a US layout. AltGr characters are handled above and must
  // not be interpreted as their physical position.
  if (!altGraph && e.key.length === 1 && e.key.charCodeAt(0) > 0x7f) {
    const letter = /^Key([A-Z])$/.exec(e.code);
    if (letter && /^\p{L}$/u.test(e.key)) {
      add(letter[1], false);
    } else {
      const us = US_PUNCTUATION_BY_CODE[e.code];
      if (us) add(e.shiftKey ? us[1] : us[0], e.shiftKey);
    }
  }

  return [...fallbacks];
}

export function createHotkeyMatcher(
  e: KeyboardEvent,
  overrides: Record<string, string>,
  scope: HotkeyScope,
  only?: HotkeyId,
): (id: HotkeyId) => boolean {
  const binding = eventToBinding(e);
  const isEligible = (id: HotkeyId) => HOTKEY_MAP[id].scope === scope && (!only || id === only);
  const matchesExact = (id: HotkeyId) =>
    isEligible(id) && effectiveBinding(id, overrides) === binding;
  const fallbacks = defaultBindingFallbacks(e);
  if (fallbacks.length === 0 || isTypingTarget(e)) return matchesExact;

  // An active local shortcut also takes precedence over a global fallback.
  const exactMatchExists = HOTKEYS.some(
    (def) =>
      effectiveBinding(def.id, overrides) === binding &&
      (isEligible(def.id) || (scope === "Global" && isActiveLocalHotkeyScope(e, def.scope))),
  );
  if (exactMatchExists) return matchesExact;

  return (id) =>
    isEligible(id) &&
    !bindingOverride(id, overrides) &&
    fallbacks.includes(HOTKEY_MAP[id].defaultBinding);
}

export function findHotkeyMatch(
  e: KeyboardEvent,
  overrides: Record<string, string>,
  scope: HotkeyScope,
): HotkeyId | null {
  const matches = createHotkeyMatcher(e, overrides, scope);
  return HOTKEYS.find(({ id }) => matches(id))?.id ?? null;
}
