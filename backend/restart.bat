@echo off
echo ==============================================
echo Restarting VDO Backend (Rust Port 4103)...
echo ==============================================
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :4103 ^| findstr LISTENING') do (
    echo Killing Process %%a on port 4103...
    taskkill /F /PID %%a /T
)
timeout /t 2 /nobreak > nul
cd /d "E:\Web\vdo\backend"
start "VDO-Backend" /b target\release\video_server.exe
echo [DONE] VDO-Backend restarted successfully.
