Set-Location 'C:\Users\glpc_\My projects\Harbor-beta-branch'
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "Starting Harbor Dev (WebView2 Desktop App)" -ForegroundColor Green
Write-Host "=========================================" -ForegroundColor Cyan

# Automatically free port 1420 if previously occupied
$conns = Get-NetTCPConnection -LocalPort 1420 -ErrorAction SilentlyContinue
if ($conns) {
    Write-Host "Clearing previous process on port 1420..." -ForegroundColor Yellow
    foreach ($c in $conns) {
        if ($c.OwningProcess -gt 0) {
            Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue
        }
    }
    Start-Sleep -Milliseconds 600
}

pnpm tauri dev
