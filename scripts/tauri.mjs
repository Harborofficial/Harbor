#!/usr/bin/env node
// Preserve the usual pnpm tauri interface. Windows desktop dev/build compiles
// the Whisper engine, while its model is still an optional in-app download.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { addWhisperFeature, shouldEnableWindowsWhisper } from "./tauri-args.mjs";

const require = createRequire(import.meta.url);
const cli = require.resolve("@tauri-apps/cli/tauri.js");
const scriptsDir = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const withWhisper = shouldEnableWindowsWhisper(process.platform, args);
const command = withWhisper ? "powershell.exe" : process.execPath;
const fullArgs = withWhisper
  ? [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      join(scriptsDir, "tauri-whisper-run.ps1"),
      Buffer.from(JSON.stringify([cli, ...addWhisperFeature(args)]), "utf8").toString("base64"),
    ]
  : [cli, ...args];

function runTauri() {
  const child = spawn(command, fullArgs, {
    stdio: "inherit",
    cwd: process.cwd(),
    env: process.env,
  });
  child.on("error", (error) => {
    console.error("Unable to start Tauri:", error.message);
    process.exitCode = 1;
  });
  child.on("exit", (code, signal) => {
    process.exitCode = code ?? (signal ? 1 : 0);
  });
}

// All Windows release builds carry the shared, self-contained Moonshine
// worker. Development runs do not build it or download any language models.
if (process.platform === "win32" && args[0] === "build") {
  const worker = spawn(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      join(scriptsDir, "build-moonshine-worker.ps1"),
    ],
    { stdio: "inherit", cwd: process.cwd(), env: process.env },
  );
  worker.on("error", (error) => {
    console.error("Unable to stage Moonshine worker:", error.message);
    process.exitCode = 1;
  });
  worker.on("exit", (code) => {
    if (code !== 0) {
      process.exitCode = code ?? 1;
      return;
    }
    runTauri();
  });
} else {
  runTauri();
}
