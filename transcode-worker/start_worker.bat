@echo off
title Intel QSV Transcode Worker (Port 4105)
color 0a

cd /d "%~dp0"


:RETRY
echo.
echo =======================================================
echo  Starting Intel QSV Video Transcode Worker...
echo =======================================================

node worker.js

echo.
echo Worker stopped or ERROR!
echo Retrying in 10 seconds...

timeout /t 10 /nobreak

goto RETRY