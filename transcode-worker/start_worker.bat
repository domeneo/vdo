@echo off
title Intel QSV Transcode Worker (Port 4105)
color 0a
echo =======================================================
echo  Starting Intel QSV Video Transcode Worker...
echo =======================================================
cd /d "%~dp0"
node worker.js
pause
