@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0.."
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\rebuild-static.ps1"
if /I not "%~1"=="no-pause" pause
