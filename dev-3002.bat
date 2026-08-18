@echo off
cd /d F:\AI\Other\Comfy-APP
set "BASH_ENV="
set "NODE_OPTIONS="
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr /i ":3002"') do taskkill /PID %%a /F 2>nul
call npx --no-install next dev -p 3002
