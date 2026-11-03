# ============================================================
# VDO Project - All-in-One Deployment Script (PowerShell)
# ============================================================
param (
    [switch]$FrontendOnly,
    [switch]$BackendOnly,
    [switch]$WorkerOnly
)

$ErrorActionPreference = "Stop"
$ROOT_DIR = "d:\SourceCode\CODE\MyProject\vdo"
$SERVER_IP = "192.168.1.242"
$WORKER_IP = "192.168.1.40"

function Deploy-Frontend {
    Write-Host "`n>>> [1/3] Building & Deploying Frontend (Vite Single-Port)..." -ForegroundColor Cyan
    Set-Location "$ROOT_DIR\frontend-vite"
    npm run build
    
    Write-Host "Syncing dist to local backend and remote server..." -ForegroundColor DarkCyan
    robocopy "$ROOT_DIR\frontend-vite\dist" "$ROOT_DIR\backend\dist" /E /NFL /NDL /NJH /NJS /nc /ns /np
    robocopy "$ROOT_DIR\frontend-vite\dist" "\\$SERVER_IP\web\vdo\backend\dist" /E /NFL /NDL /NJH /NJS /nc /ns /np
    Write-Host "[SUCCESS] Frontend deployed to port 4103!" -ForegroundColor Green
}

function Deploy-Backend {
    Write-Host "`n>>> [2/3] Building & Deploying Rust Backend..." -ForegroundColor Cyan
    Set-Location "$ROOT_DIR\backend"
    cargo build --release

    Write-Host "Restarting remote video_server.exe on $SERVER_IP..." -ForegroundColor DarkCyan
    taskkill /s $SERVER_IP /f /im video_server.exe 2>$null
    Start-Sleep -Seconds 1
    
    robocopy "$ROOT_DIR\backend\target\release" "\\$SERVER_IP\web\vdo\backend\target\release" video_server.exe /NFL /NDL /NJH /NJS /nc /ns /np
    wmic /node:$SERVER_IP process call create "E:\Web\vdo\backend\target\release\video_server.exe" | Out-Null
    Write-Host "[SUCCESS] Backend compiled & restarted successfully!" -ForegroundColor Green
}

function Deploy-Worker {
    Write-Host "`n>>> [3/3] Deploying Transcode Worker to $WORKER_IP..." -ForegroundColor Cyan
    robocopy "$ROOT_DIR\transcode-worker" "\\$WORKER_IP\d$\transcode-worker" worker.js /NFL /NDL /NJH /NJS /nc /ns /np
    Write-Host "[SUCCESS] Worker.js updated on $WORKER_IP! (Please restart start_worker.bat on $WORKER_IP)" -ForegroundColor Yellow
}

# --- Execution Logic ---
if ($FrontendOnly) {
    Deploy-Frontend
} elseif ($BackendOnly) {
    Deploy-Backend
} elseif ($WorkerOnly) {
    Deploy-Worker
} else {
    Deploy-Frontend
    Deploy-Worker
}

Set-Location $ROOT_DIR
Write-Host "`n============================================================" -ForegroundColor Green
Write-Host " Deployment completed! Enjoy your movies! " -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
