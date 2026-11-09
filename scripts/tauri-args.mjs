// Shared argument policy for the Harbor Tauri launcher.
// Keep non-Windows and non-desktop commands exactly as the user entered them.
export function shouldEnableWindowsWhisper(platform, args) {
  const command = args[0];
  return (
    platform === "win32" &&
    (command === "dev" || command === "build") &&
    !args.includes("-h") &&
    !args.includes("--help") &&
    !args.includes("--version")
  );
}

export function addWhisperFeature(args) {
  const result = [...args];
  const divider = result.indexOf("--");
  const end = divider < 0 ? result.length : divider;
  for (let i = 0; i < end; i += 1) {
    const token = result[i];
    if (token === "--features" || token === "-f") {
      const value = result[i + 1];
      if (value === undefined || value.startsWith("-")) {
        result.splice(i + 1, 0, "asr-whisper");
      } else if (!value.split(/[\s,]+/).includes("asr-whisper")) {
        result[i + 1] = value + ",asr-whisper";
      }
      return result;
    }
    if (token.startsWith("--features=") || token.startsWith("-f=")) {
      const eq = token.indexOf("=");
      const value = token.slice(eq + 1);
      if (!value.split(/[\s,]+/).includes("asr-whisper")) {
        result[i] = token + (value ? ",asr-whisper" : "asr-whisper");
      }
      return result;
    }
  }
  result.splice(end, 0, "--features", "asr-whisper");
  return result;
}
