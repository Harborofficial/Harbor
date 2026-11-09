#Requires -Version 5.1
# Windows development app with Whisper support; Linux/dev defaults are unchanged.
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

# Free port 1420 if still bound by an orphaned Vite / Node dev server
try {
    Get-NetTCPConnection -LocalPort 1420 -State Listen -ErrorAction SilentlyContinue | ForEach-Object {
        Write-Host "Releasing port 1420 (PID $($_.OwningProcess))..." -ForegroundColor Yellow
        Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue
    }
} catch {}

# Ensure required sidecars exist before invoking tauri dev
if (-not (Test-Path "$repo\src-tauri\binaries\yt-dlp-x86_64-pc-windows-msvc.exe")) {
    Write-Host "Fetching required sidecar binaries..." -ForegroundColor Cyan
    & node scripts/fetch-binaries.mjs
}
if (-not (Test-Path "$repo\src-tauri\libmpv\libmpv-2.dll")) {
    Write-Host "Fetching libmpv..." -ForegroundColor Cyan
    & node scripts/fetch-libmpv.mjs
}
if (-not (Test-Path "$repo\src-tauri\binaries\mpv-x86_64-pc-windows-msvc.exe")) {
    Write-Host "Fetching mpv binary..." -ForegroundColor Cyan
    & node scripts/fetch-mpv.mjs
}
if (-not (Test-Path "$repo\src-tauri\fonts\NotoSansJP-Regular.otf")) {
    Write-Host "Fetching fonts..." -ForegroundColor Cyan
    & node scripts/fetch-fonts.mjs
}

# The regular pnpm tauri entry point handles Whisper's native build requirements.
& pnpm tauri dev
if ($LASTEXITCODE -ne 0) { throw "Harbor Windows dev build failed: $LASTEXITCODE" }
