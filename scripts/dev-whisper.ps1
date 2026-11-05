#Requires -Version 5.1
# Windows development app with Whisper support; Linux/dev defaults are unchanged.
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo
# The regular pnpm tauri entry point handles Whisper's native build requirements.
& pnpm tauri dev
if ($LASTEXITCODE -ne 0) { throw "Harbor Windows dev build failed: $LASTEXITCODE" }
