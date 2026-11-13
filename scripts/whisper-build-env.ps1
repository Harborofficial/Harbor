# Windows-only native Whisper toolchain setup, shared by dev and release builds.
# Dependencies are build-time only; end users download just the model in Harbor.

# whisper-rs-sys bundled bindings were generated for a different target.
# Always generate correct Windows bindings rather than using those layouts.
# PowerShell/.NET can retain this as an empty environment entry. The crate
# checks for presence, not its value, so remove the entry through the provider.
Remove-Item Env:WHISPER_DONT_GENERATE_BINDINGS -ErrorAction SilentlyContinue

$vswhere = 'C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe'
$vs = $null
if (Test-Path -LiteralPath $vswhere) {
  $vs = & $vswhere -latest -products '*' -property installationPath
}

if (-not (Get-Command cmake -ErrorAction SilentlyContinue)) {
  $cmakePaths = @('C:\Program Files\CMake\bin')
  if ($vs) {
    $cmakePaths += (Join-Path $vs 'Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin')
  }
  $cmakeDir = $cmakePaths | Where-Object { Test-Path -LiteralPath (Join-Path $_ 'cmake.exe') } | Select-Object -First 1
  if (-not $cmakeDir) {
    throw 'Whisper requires CMake at build time. Install CMake or the Visual Studio C++ CMake tools.'
  }
  $env:PATH = "$cmakeDir;$env:PATH"
}

$clangCandidates = @(
  'C:\Program Files\LLVM\bin\libclang.dll',
  'C:\Program Files (x86)\LLVM\bin\libclang.dll'
)
if ($vs) {
  $clangCandidates += (Join-Path $vs 'VC\Tools\Llvm\x64\bin\libclang.dll')
}
if ($env:LIBCLANG_PATH) {
  $clangCandidates += (Join-Path $env:LIBCLANG_PATH 'libclang.dll')
}

$repo = Split-Path -Parent $PSScriptRoot
$cacheDir = Join-Path $repo 'src-tauri\target\whisper-toolchain'
$cachedClang = Join-Path $cacheDir 'libclang-18.1.1.data\platlib\clang\native\libclang.dll'
$clangCandidates += $cachedClang
$clangDll = $clangCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1

if (-not $clangDll) {
  Write-Host 'Downloading portable libclang build dependency (one-time, Windows only)...' -ForegroundColor Cyan
  New-Item -ItemType Directory -Path $cacheDir -Force | Out-Null
  $wheel = Get-ChildItem -LiteralPath $cacheDir -Filter 'libclang-18.1.1-*.whl' -File | Select-Object -First 1
  if (-not $wheel) {
    $wheelUrl = 'https://files.pythonhosted.org/packages/0b/2d/3f480b1e1d31eb3d6de5e3ef641954e5c67430d5ac93b7fa7e07589576c7/libclang-18.1.1-py2.py3-none-win_amd64.whl'
    $targetWheel = Join-Path $cacheDir 'libclang-18.1.1-py2.py3-none-win_amd64.whl'
    try {
      [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
      Invoke-WebRequest -Uri $wheelUrl -OutFile $targetWheel -UseBasicParsing
    } catch {
      if (Get-Command curl.exe -ErrorAction SilentlyContinue) {
        & curl.exe -fsSL $wheelUrl -o $targetWheel
      } elseif (Get-Command python -ErrorAction SilentlyContinue) {
        & python -m pip download --disable-pip-version-check --no-deps --only-binary=:all: --dest $cacheDir libclang==18.1.1
      }
    }
    $wheel = Get-ChildItem -LiteralPath $cacheDir -Filter 'libclang-18.1.1-*.whl' -File | Select-Object -First 1
  }
  if (-not $wheel) { throw 'Could not fetch libclang. Install LLVM and set LIBCLANG_PATH, then rebuild.' }
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  # A previous interrupted extraction may have left partial wheel contents.
  foreach ($name in @('libclang-18.1.1.data', 'libclang-18.1.1.dist-info')) {
    Remove-Item -LiteralPath (Join-Path $cacheDir $name) -Recurse -Force -ErrorAction SilentlyContinue
  }
  [System.IO.Compression.ZipFile]::ExtractToDirectory($wheel.FullName, $cacheDir)
  if (-not (Test-Path -LiteralPath $cachedClang)) {
    throw 'Downloaded libclang wheel did not contain the expected Windows library.'
  }
  $clangDll = $cachedClang
}

$env:LIBCLANG_PATH = Split-Path -Parent $clangDll
