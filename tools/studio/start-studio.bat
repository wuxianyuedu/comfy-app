@echo off
chcp 65001 >nul
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-studio.ps1"
if /I not "%~1"=="no-pause" pause
