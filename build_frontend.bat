@echo off
echo ==============================================
echo  Building Vite Frontend and Syncing to Dist
echo ==============================================
cd /d "d:\SourceCode\CODE\MyProject\vdo\frontend-vite"
call npm run build
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Frontend build failed!
    exit /b %ERRORLEVEL%
)

echo.
echo Syncing dist to backend...
robocopy "d:\SourceCode\CODE\MyProject\vdo\frontend-vite\dist" "d:\SourceCode\CODE\MyProject\vdo\backend\dist" /E /NFL /NDL /NJH /NJS /nc /ns /np

echo.
echo Deploying all to Server (\\192.168.1.242\web\vdo)...
robocopy "d:\SourceCode\CODE\MyProject\vdo\backend" "\\192.168.1.242\web\vdo\backend" /E /XD target cache /NFL /NDL /NJH /NJS /nc /ns /np

echo.
echo [DONE] Frontend built and deployed directly into Rust Backend!
