@echo off
echo ==========================================
echo  Rebuilding Rust Video Server (Backend)
echo ==========================================
cd /d "E:\Web\vdo\backend"
set PATH=%USERPROFILE%\.cargo\bin;%PATH%
cargo build --release
if %ERRORLEVEL% equ 0 (
    echo.
    echo [SUCCESS] Backend compiled successfully!
    echo You can now restart VDO-Backend in Swan Service Manager.
) else (
    echo.
    echo [ERROR] Build failed!
)
pause
