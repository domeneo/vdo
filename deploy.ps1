# Deploy Playbook Script for VDO (Next.js & Rust Axum)
# According to remote-server-deploy playbook

Write-Host "=========================================" -ForegroundColor Cyan
Write-Host " 1. Building Frontend (Next.js)..." -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
cd "d:\SourceCode\CODE\MyProject\vdo\frontend"
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] Frontend build failed!" -ForegroundColor Red
    exit 1
}

Write-Host "=========================================" -ForegroundColor Cyan
Write-Host " 2. Syncing files via Robocopy..." -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
robocopy "d:\SourceCode\CODE\MyProject\vdo" "\\192.168.1.242\web\vdo" /E /XD node_modules target .git cache /NFL /NDL /NJH /NJS /nc /ns /np

Write-Host "=========================================" -ForegroundColor Cyan
Write-Host " 3. Triggering Remote Process Restarts..." -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
wmic /node:192.168.1.242 process call create "cmd.exe /c E:\Web\vdo\frontend\restart.bat"
wmic /node:192.168.1.242 process call create "cmd.exe /c E:\Web\vdo\backend\restart.bat"

Write-Host "[SUCCESS] Deployed and restarted remote services via WMIC successfully!" -ForegroundColor Green
