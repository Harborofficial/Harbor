#Requires -Version 5.1
# Invoked by scripts/tauri.mjs for Windows desktop dev and build commands.
param([Parameter(Mandatory=$true)][string]$Base64Args)
$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $scriptDir 'whisper-build-env.ps1')

$decoded = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Base64Args))
$commandArgs = [string[]](ConvertFrom-Json -InputObject $decoded)
if ($commandArgs.Count -lt 2) { throw 'Missing Tauri CLI arguments.' }
$cli = [string]$commandArgs[0]
$nativeArgs = @($commandArgs | Select-Object -Skip 1)
& node $cli @nativeArgs
exit $LASTEXITCODE
