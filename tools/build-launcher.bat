@echo off
chcp 65001 >nul
setlocal

rem ============================================================================
rem  build-launcher.bat — 重新打包 start-tauri.exe
rem
rem  产物：<项目根>\start-tauri\start-tauri.exe （onedir 模式）
rem  说明：本脚本位于 <项目根>\tools\，会自动 cd 到项目根目录再打包。
rem        打包前会删除旧的 start-tauri\ 与 build-launcher\ 产物。
rem ============================================================================

cd /d "%~dp0.."
set "PROJECT_ROOT=%CD%"

echo ==========================================================
echo   Comfy APP - 重新打包 start-tauri.exe
echo ==========================================================
echo   项目根目录: %PROJECT_ROOT%
echo.

rem ---- 1. 检查 Python / PyInstaller ----
where python >nul 2>&1
if errorlevel 1 (
  echo [错误] 未找到 python，请先安装 Python 3.10+ 并加入 PATH。
  pause
  exit /b 1
)

where pyinstaller >nul 2>&1
if errorlevel 1 (
  echo [错误] 未找到 pyinstaller。请先安装：
  echo.
  echo        pip install pyinstaller
  echo.
  pause
  exit /b 1
)

echo [1/3] 环境检查
python --version
pyinstaller --version
echo.

rem ---- 2. 清理旧产物 ----
echo [2/3] 清理旧产物...
if exist "%PROJECT_ROOT%\start-tauri" rmdir /s /q "%PROJECT_ROOT%\start-tauri"
if exist "%PROJECT_ROOT%\build-launcher" rmdir /s /q "%PROJECT_ROOT%\build-launcher"
echo       已清理 start-tauri\ 与 build-launcher\
echo.

rem ---- 3. 打包 ----
echo [3/3] 开始打包（onedir 模式，耗时约 1-3 分钟）...
pyinstaller --clean --noconfirm ^
  --distpath . ^
  --workpath build-launcher ^
  "%~dp0start-tauri.spec"

if errorlevel 1 (
  echo.
  echo [错误] 打包失败，请查看上方输出。
  pause
  exit /b 1
)

echo.
echo ==========================================================
echo   打包完成
echo   产物: %PROJECT_ROOT%\start-tauri\start-tauri.exe
echo ==========================================================
echo.
pause
