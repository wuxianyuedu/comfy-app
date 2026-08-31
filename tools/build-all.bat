@echo off
chcp 936 >nul
setlocal
rem 一键发布构建：先构建 release Tauri 壳，再打包 start-tauri.exe
rem 编排脚本（不重复实现构建逻辑，分别 call 子脚本）。

cd /d "%~dp0"
echo ==========================================================
echo   Comfy APP - 一键发布构建
echo ==========================================================
echo   1) 构建 release Tauri 壳   (build-tauri-release.bat)
echo   2) 打包 start-tauri.exe    (build-launcher.bat)
echo ==========================================================
echo.

call "%~dp0build-tauri-release.bat"
if errorlevel 1 (
  echo [错误] Tauri 壳构建失败，已中止发布流程。
  pause
  exit /b 1
)

call "%~dp0build-launcher.bat"
if errorlevel 1 (
  echo [错误] start-tauri.exe 打包失败，已中止发布流程。
  pause
  exit /b 1
)

echo.
echo ==========================================================
echo   全部完成
echo   可双击 <项目根>\start-tauri\start-tauri.exe 启动应用
echo   （将自动使用 release 版 Tauri 壳，启动更快）
echo ==========================================================
echo.
pause
