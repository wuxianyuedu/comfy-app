@echo off
chcp 936 >nul
setlocal

cd /d "%~dp0"
set "PROJECT_ROOT=%~dp0.."
set "LOG=%PROJECT_ROOT%\build-all.log"
if exist "%LOG%" del "%LOG%"

call :log ==========================================================
call :log   Comfy APP - 一键发布构建
call :log ==========================================================
call :log   1) 构建 release Tauri 壳   (build-tauri-release.bat)
call :log   2) 打包 start-tauri.exe    (build-launcher.bat)
call :log ==========================================================
call :log.

call "%~dp0build-tauri-release.bat" no-pause >> "%LOG%" 2>&1
if errorlevel 1 (
  call :log [错误] Tauri 壳构建失败，已中止发布流程。
  notepad "%LOG%"
  pause
  exit /b 1
)

call "%~dp0build-launcher.bat" no-pause >> "%LOG%" 2>&1
if errorlevel 1 (
  call :log [错误] start-tauri.exe 打包失败，已中止发布流程。
  notepad "%LOG%"
  pause
  exit /b 1
)

call :log.
call :log ==========================================================
call :log   全部完成
call :log   可双击 %PROJECT_ROOT%\start-tauri\start-tauri.exe 启动应用
call :log   （将自动使用 release 版 Tauri 壳，启动更快）
call :log ==========================================================
call :log.
pause
exit /b

:log
echo %* >> "%LOG%" 2>&1
echo %*
goto :eof
