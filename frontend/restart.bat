@echo off
echo ==============================================
echo Restarting VDO Frontend (Next.js Port 4104)...
echo ==============================================
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :4104 ^| findstr LISTENING') do (
    echo Killing Process %%a on port 4104...
    taskkill /F /PID %%a /T
)
timeout /t 2 /nobreak > nul
cd /d "E:\Web\vdo\frontend"
set PORT=4104
start "VDO-Frontend" /b npm start
echo [DONE] VDO-Frontend restarted successfully.
