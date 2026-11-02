# deploy.ps1 - สคริปต์ Sync โปรเจกต์ไปยัง \\192.168.1.242\web\vdo
param(
    [string]$Destination = "\\192.168.1.242\web\vdo"
)

Write-Host "🚀 เริ่มกระบวนการ Deploy ไปยัง: $Destination" -ForegroundColor Cyan

if (-not (Test-Path $Destination)) {
    Write-Host "❌ ไม่สามารถเข้าถึงปลายทาง $Destination ได้" -ForegroundColor Red
    exit 1
}

Write-Host "📦 กำลังคัดลอกไฟล์โปรเจกต์..." -ForegroundColor Yellow

$ExcludeDirs = @("node_modules", "target", ".git", ".next", "cache")

robocopy "d:\SourceCode\CODE\MyProject\vdo" $Destination /E /XD $ExcludeDirs /NFL /NDL /NJH /NJS /nc /ns /np

Write-Host "✅ คัดลอกไฟล์เสร็จสิ้น!" -ForegroundColor Green
Write-Host "👉 ปลายทาง: $Destination"
