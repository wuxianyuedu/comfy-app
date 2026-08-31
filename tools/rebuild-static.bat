@echo off
chcp 936 >nul
setlocal

rem 清理并完整重建 src-tauri/static，修复 static 被污染 / 缺 standalone 导致的启动黑屏。
rem 用法：双击本脚本（位于 tools\ 下），会自动定位到项目根后执行。

cd /d "%~dp0.."
set "PROJECT_ROOT=%CD%"
set "STATIC_DIR=%PROJECT_ROOT%\src-tauri\static"

echo ==========================================================
echo  Comfy APP - 清理并重建前端资源 (src-tauri/static)
echo ==========================================================
echo  项目根: %PROJECT_ROOT%
echo.

if exist "%STATIC_DIR%" (
  echo [1/2] 删除旧的 static 目录（含污染的整项目副本）...
  rmdir /S /Q "%STATIC_DIR%"
) else (
  echo [1/2] 未检测到 static 目录，跳过删除。
)

echo [2/2] 运行 build-desktop.mjs（会执行 pnpm build 生成 standalone，耗时较长）...
node scripts/build-desktop.mjs
if errorlevel 1 (
  echo [错误] build-desktop.mjs 失败，请查看上方输出。
  pause
  exit /b 1
)

echo.
echo ==========================================================
echo  重建完成。接下来请运行：
echo    tools\build-tauri-release.bat   （重新 cargo build 嵌入干净的前端资源）
echo  或 tools\build-all.bat           （完整发布构建）
echo ==========================================================
echo.
pause
