param([switch]$Force)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($PSVersionTable.PSVersion.Major -ge 6 -and -not $IsWindows) {
  throw 'The bundled Moonshine worker currently targets Windows only.'
}
$repo = Split-Path -Parent $PSScriptRoot
$workerSource = Join-Path $repo 'src-tauri/src/subsync/moonshine_worker.py'
$destination = Join-Path $repo 'src-tauri/resources/moonshine'
$exe = Join-Path $destination 'moonshine-worker.exe'
$toolchain = Join-Path $repo 'src-tauri/target/moonshine-toolchain'
$venvPython = Join-Path $toolchain 'venv/Scripts/python.exe'

New-Item -ItemType Directory -Path $destination, $toolchain -Force | Out-Null
if ((Test-Path -LiteralPath $exe) -and -not $Force) {
  $staged = Get-Item -LiteralPath $exe
  $source = Get-Item -LiteralPath $workerSource
  if ($staged.LastWriteTimeUtc -ge $source.LastWriteTimeUtc) {
    Write-Host "Using staged Moonshine worker: $exe"
    exit 0
  }
  Write-Host 'Moonshine worker source changed; rebuilding the staged executable.'
}
if (-not (Test-Path -LiteralPath $venvPython)) {
  & python -m venv (Join-Path $toolchain 'venv')
  if ($LASTEXITCODE -ne 0) { throw 'Python 3 is needed only on the machine building the Windows runtime.' }
}
& $venvPython -m pip install --disable-pip-version-check --upgrade 'moonshine-voice==0.1.6' 'pyinstaller==6.16.0'
if ($LASTEXITCODE -ne 0) { throw 'Moonshine build dependency installation failed' }

& $venvPython -m PyInstaller --noconfirm --clean --onefile --console --name 'moonshine-worker' --collect-all moonshine_voice --distpath $destination --workpath (Join-Path $toolchain 'work') --specpath (Join-Path $toolchain 'spec') $workerSource
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $exe)) {
  throw 'Self-contained Moonshine worker build failed'
}
$check = & $exe 'status' (Join-Path $env:TEMP 'harbor-moonshine-build-smoke') 'en'
if ($LASTEXITCODE -ne 0 -or -not (($check -join [Environment]::NewLine) -match 'HARBOR_MOONSHINE_RESULT=.*"runtimeInstalled": true')) {
  throw 'Bundled Moonshine worker failed its runtime self-test'
}
Write-Host "Bundled Moonshine worker ready: $exe"
