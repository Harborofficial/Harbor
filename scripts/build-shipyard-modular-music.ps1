#Requires -Version 5.1
<#
  Experimental single-executable Shipyard build with removable native Music.
  Does NOT replace src-tauri/target/release/harbor.exe or touch installed data.
  This build must pass full on-device Music regression tests before release.
#>
[CmdletBinding()]
param(
  [switch]$SkipFrontend,
  [switch]$SkipCore,
  [switch]$SkipModule,
  [switch]$BuildInstaller
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo
$coreDir = Join-Path $repo 'src-tauri\target\music-sidecar'
$coreExe = Join-Path $coreDir 'release\harbor.exe'
$moduleExe = Join-Path $repo 'src-tauri\music-module\target\release\harbor-music-module.exe'
$manifest = Join-Path $repo 'src-tauri\resources\music-module\music-module.json'

function Run([string]$file,[string[]]$arguments) {
  & $file @arguments
  if ($LASTEXITCODE -ne 0) { throw "$file $($arguments -join ' ') failed with exit $LASTEXITCODE" }
}

if (-not $SkipFrontend) {
  Run 'pnpm' @('build:desktop')
}
if (-not $SkipCore) {
  $oldTarget = $env:CARGO_TARGET_DIR
  try {
    $env:CARGO_TARGET_DIR = $coreDir
    Run 'cargo' @('build', '--manifest-path', 'src-tauri/Cargo.toml', '--locked',
      '--release', '--no-default-features', '--features', 'games,plugins,music,music-sidecar,tauri/custom-protocol',
      '--bin', 'harbor')
  } finally {
    $env:CARGO_TARGET_DIR = $oldTarget
  }
}
if (-not (Test-Path -LiteralPath $coreExe)) { throw "No experimental sidecar core: $coreExe" }

if (-not $SkipModule) {
  Run 'powershell' @('-NoProfile','-ExecutionPolicy','Bypass','-File','scripts/build-music-module.ps1','-Release')
}
if (-not (Test-Path -LiteralPath $moduleExe) -or -not (Test-Path -LiteralPath $manifest)) {
  throw 'Native Music module has not been built and staged.'
}
$expectedVersion = (Get-Content src-tauri/tauri.conf.json -Raw | ConvertFrom-Json).version
$mod = Get-Content $manifest -Raw | ConvertFrom-Json
if ($mod.kind -ne 'harbor-music' -or $mod.abi -ne 1 -or $mod.version -ne $expectedVersion) {
  throw 'Native Music module ABI or version mismatch.'
}
Write-Host 'One alternate Harbor Core and one optional Music module built.' -ForegroundColor Green
Write-Host "  Core: $coreExe"
Write-Host "  Music: $moduleExe"

if ($BuildInstaller) {
  # Existing source release remains untouched; Shipyard selects only this
  # verified feature build inside its single managed payload.
  $oldFeature = $env:HARBOR_MUSIC_MODULE_EXPERIMENTAL
  $oldCore = $env:HARBOR_MUSIC_CORE_EXE
  try {
    $env:HARBOR_MUSIC_MODULE_EXPERIMENTAL = '1'
    $env:HARBOR_MUSIC_CORE_EXE = $coreExe
    Run 'powershell' @('-NoProfile','-ExecutionPolicy','Bypass','-File',
      'scripts/build-shipyard.ps1','-SkipApp','-Channel','beta')
  } finally {
    $env:HARBOR_MUSIC_MODULE_EXPERIMENTAL = $oldFeature
    $env:HARBOR_MUSIC_CORE_EXE = $oldCore
  }
}
