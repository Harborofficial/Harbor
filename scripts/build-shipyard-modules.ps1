#Requires -Version 5.1
<#
  General Shipyard build with optional native components.

  One command builds the sidecar core, stages the components that are requested,
  and calls the normal Shipyard packaging pipeline. It does not change
  `pnpm shipyard`; that command remains the default legacy-Music build.

  Examples:
    powershell -File scripts/build-shipyard-modules.ps1
    powershell -File scripts/build-shipyard-modules.ps1 -SkipGames
    powershell -File scripts/build-shipyard-modules.ps1 -SkipFrontend -SkipGames -SkipPlugins
#>
[CmdletBinding()]
param(
  [switch]$SkipFrontend,
  [switch]$SkipCore,
  [switch]$SkipMusic,
  [switch]$SkipGames,
  [switch]$SkipPlugins,
  [switch]$RebuildGames,
  [switch]$RebuildPlugins,
  [ValidateSet('stable', 'beta')]
  [string]$Channel,
  [switch]$Run
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

$coreDir = Join-Path $repo 'src-tauri\target\music-sidecar'
$coreExe = Join-Path $coreDir 'release\harbor.exe'
$musicStage = Join-Path $repo 'src-tauri\target\shipyard-modules\music'
$musicExe = Join-Path $musicStage 'harbor-music-module.exe'
$musicManifest = Join-Path $musicStage 'music-module.json'
$gamesStage = Join-Path $repo 'src-tauri\resources\pokemon-engine'
$gamesExe = Join-Path $gamesStage 'Harbor.PokemonEngine.exe'
$pokemonSource = Join-Path $repo 'src-tauri\target\shipyard-modules\pokemon-source'
$pokemonArtifacts = Join-Path $repo 'src-tauri\target\shipyard-modules\pokemon-artifacts'
$capstanStage = Join-Path $repo 'src-tauri\resources\capstan'
$capstanJar = Join-Path $capstanStage 'capstan.jar'
$capstanModule = Join-Path $capstanStage 'harbor-extensions-module.exe'
$capstanManifest = Join-Path $capstanStage 'extensions-module.json'

function Step([string]$text) {
  Write-Host "`n=== $text ===" -ForegroundColor Cyan
}

function Invoke-Tool([string]$file, [string[]]$arguments) {
  & $file @arguments
  if ($LASTEXITCODE -ne 0) { throw "$file $($arguments -join ' ') failed with exit $LASTEXITCODE" }
}

function Set-Env([string]$name, [string]$value) {
  [Environment]::SetEnvironmentVariable($name, $value, 'Process')
}

if ($SkipFrontend -and -not (Test-Path -LiteralPath 'dist/index.html')) {
  throw 'No frontend build found in dist/. Run without -SkipFrontend or build the frontend first.'
}

$channel = if ($PSBoundParameters.ContainsKey('Channel')) {
  $Channel
} elseif ($env:HARBOR_CHANNEL) {
  $env:HARBOR_CHANNEL
} else {
  'beta'
}
# The app and sidecar core stamp themselves from this at build time.
$env:HARBOR_CHANNEL = $channel

Write-Host "Shipyard components:"
Write-Host ("  Core:     sidecar Music ({0})" -f $(if ($SkipCore) { 'reuse' } else { 'build' }))
Write-Host ("  Music:    {0}" -f $(if ($SkipMusic) { 'skip' } else { 'build' }))
Write-Host ("  Games:    {0}" -f $(if ($SkipGames) { 'skip' } else { 'build or reuse' }))
Write-Host ("  Plugins:  {0}" -f $(if ($SkipPlugins) { 'skip' } else { 'stage or reuse' }))

# The frontend build also runs the extension staging step. Do not let it silently
# omit Extensions when that component was requested.
$savedCapstanOptional = [Environment]::GetEnvironmentVariable('HARBOR_CAPSTAN_OPTIONAL', 'Process')
Set-Env 'HARBOR_CAPSTAN_OPTIONAL' $(if ($SkipPlugins) { '1' } else { $null })
try {
  if (-not $SkipFrontend) {
    Step 'Frontend build'
    Invoke-Tool 'pnpm' @('build:desktop')
  }
} finally {
  Set-Env 'HARBOR_CAPSTAN_OPTIONAL' $savedCapstanOptional
}

if (-not $SkipMusic) {
  Step 'Music module build'
  Invoke-Tool 'powershell' @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass',
    '-File', 'scripts/build-music-module.ps1',
    '-Release', '-Destination', $musicStage
  )
  if (-not (Test-Path -LiteralPath $musicExe) -or -not (Test-Path -LiteralPath $musicManifest)) {
    throw "Music module did not stage at $musicStage"
  }
  $version = (Get-Content 'src-tauri/tauri.conf.json' -Raw | ConvertFrom-Json).version
  $manifest = Get-Content -LiteralPath $musicManifest -Raw | ConvertFrom-Json
  if ($manifest.kind -ne 'harbor-music' -or $manifest.abi -ne 1 -or $manifest.version -ne $version) {
    throw 'Music module ABI or version mismatch'
  }
}

if (-not $SkipCore) {
  Step 'Sidecar core build'
  $oldTarget = $env:CARGO_TARGET_DIR
  try {
    $env:CARGO_TARGET_DIR = $coreDir
    Invoke-Tool 'cargo' @(
      'build', '--manifest-path', 'src-tauri/Cargo.toml', '--locked',
      '--release', '--no-default-features', '--features',
      'games,plugins,music,music-sidecar,tauri/custom-protocol', '--bin', 'harbor'
    )
  } finally {
    $env:CARGO_TARGET_DIR = $oldTarget
  }
}
if (-not (Test-Path -LiteralPath $coreExe)) {
  throw "No sidecar core at $coreExe"
}

if (-not $SkipGames) {
  Step 'Game engine'
  if ((Test-Path -LiteralPath $gamesExe) -and -not $RebuildGames) {
    Write-Host "Using staged game engine: $gamesStage" -ForegroundColor Yellow
  } else {
    $sdks = & dotnet --list-sdks 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $sdks) {
      throw 'The game engine needs the .NET SDK. Install it, or pass -SkipGames.'
    }
    Invoke-Tool 'node' @(
      'tools/pokemon-engine/build.mjs', '--fetch-source', $pokemonSource,
      '--output', $gamesStage, '--artifacts', $pokemonArtifacts
    )
  }
  if (-not (Test-Path -LiteralPath $gamesExe)) {
    throw "Game engine did not stage at $gamesStage"
  }
}

if (-not $SkipPlugins) {
  Step 'Extensions runtime'
  $staged = (Test-Path -LiteralPath $capstanJar) -and
    (Test-Path -LiteralPath $capstanModule) -and
    (Test-Path -LiteralPath $capstanManifest)
  $verified = $false
  if ($staged -and -not $RebuildPlugins) {
    & node 'scripts/capstan-stage.mjs' '--check'
    $verified = $LASTEXITCODE -eq 0
  }
  if (-not $verified) {
    # A requested Plugins component must not silently fall back to tab-only.
    Set-Env 'HARBOR_CAPSTAN_OPTIONAL' $null
    Invoke-Tool 'node' @('scripts/capstan-stage.mjs')
  }
  if (-not (Test-Path -LiteralPath $capstanJar) -or
      -not (Test-Path -LiteralPath $capstanModule) -or
      -not (Test-Path -LiteralPath $capstanManifest)) {
    throw "Extensions runtime did not stage at $capstanStage"
  }
}

Step 'Package and build Shipyard'
$saved = @{}
foreach ($name in @(
  'HARBOR_MUSIC_CORE_EXE', 'HARBOR_MUSIC_MODULE_EXPERIMENTAL', 'HARBOR_MUSIC_MODULE_DIR',
  'HARBOR_SKIP_MUSIC', 'HARBOR_SKIP_GAMES', 'HARBOR_SKIP_PLUGINS',
  'HARBOR_CAPSTAN_OPTIONAL', 'HARBOR_POKEMON_OPTIONAL'
)) {
  $saved[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}
try {
  Set-Env 'HARBOR_MUSIC_CORE_EXE' $coreExe
  Set-Env 'HARBOR_MUSIC_MODULE_EXPERIMENTAL' '1'
  if ($SkipMusic) {
    Set-Env 'HARBOR_MUSIC_MODULE_DIR' $null
    Set-Env 'HARBOR_SKIP_MUSIC' '1'
  } else {
    Set-Env 'HARBOR_MUSIC_MODULE_DIR' $musicStage
    Set-Env 'HARBOR_SKIP_MUSIC' $null
  }
  Set-Env 'HARBOR_SKIP_GAMES' $(if ($SkipGames) { '1' } else { $null })
  Set-Env 'HARBOR_SKIP_PLUGINS' $(if ($SkipPlugins) { '1' } else { $null })
  if ($SkipGames) { Set-Env 'HARBOR_POKEMON_OPTIONAL' '1' }
  if ($SkipPlugins) { Set-Env 'HARBOR_CAPSTAN_OPTIONAL' '1' }

  $arguments = @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass',
    '-File', 'scripts/build-shipyard.ps1',
    '-SkipApp', '-Channel', $channel
  )
  if ($Run) { $arguments += '-Run' }
  Invoke-Tool 'powershell' $arguments
} finally {
  foreach ($name in $saved.Keys) {
    Set-Env $name $saved[$name]
  }
}
