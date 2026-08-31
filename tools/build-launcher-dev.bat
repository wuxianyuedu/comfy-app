@echo off
chcp 936 >nul
setlocal
rem 本文件以 GBK(936) 保存 —— cmd 默认按系统 ANSI 代码页解析 bat，
rem 存成 UTF-8 会让中文注释/echo 变成乱码并被当作命令执行。
rem ============================================================================
rem  build-launcher-dev.bat — 重新打包 start-tauri-dev.exe
rem
rem  产物：<项目根>\start-tauri-dev\start-tauri-dev.exe （onedir 模式）
rem  说明：复用 tools\start-tauri.spec，通过环境变量 LAUNCHER_NAME 指定入口名，
rem        使打包出的 exe 名为 start-tauri-dev.exe。launcher 源码会按 exe 文件名
rem        判定默认走「tauri dev」模式（Rust 热重载），双击即用，无需记参数。
rem        打包前会删除旧的 start-tauri-dev\ 与 build-launcher-dev\ 产物。
rem ============================================================================

set "LAUNCHER_NAME=start-tauri-dev"

cd /d "%~dp0.."
set "PROJECT_ROOT=%CD%"

echo ==========================================================
echo   Comfy APP - 重新打包 start-tauri-dev.exe（开发模式）
echo ==========================================================
echo   项目根目录: %PROJECT_ROOT%
echo   入口名    : %LAUNCHER_NAME%（双击即走 tauri dev，Rust 热重载）
echo.

rem ---- 1. 检查 Python / PyInstaller ----
where python >nul 2>&1
if errorlevel 1 (
  echo [错误] 未找到 python，请先安装 Python 3.10+ 并加入 PATH。
  if /I not "%~1"=="no-pause" pause
  exit /b 1
)

where pyinstaller >nul 2>&1
if errorlevel 1 (
  echo [错误] 未找到 pyinstaller。请先安装：
  echo.
  echo        pip install pyinstaller
  echo.
  if /I not "%~1"=="no-pause" pause
  exit /b 1
)

echo [1/3] 环境检查
python --version
pyinstaller --version
echo.

rem ---- 2. 清理旧产物 ----
echo [2/3] 清理旧产物...
if exist "%PROJECT_ROOT%\start-tauri-dev" rmdir /s /q "%PROJECT_ROOT%\start-tauri-dev"
if exist "%PROJECT_ROOT%\build-launcher-dev" rmdir /s /q "%PROJECT_ROOT%\build-launcher-dev"
echo       已清理 start-tauri-dev\ 与 build-launcher-dev\
echo.

rem ---- 3. 打包 ----
echo [3/3] 开始打包（onedir 模式，耗时约 1-3 分钟）...
pyinstaller --clean --noconfirm ^
  --distpath . ^
  --workpath build-launcher-dev ^
  "%~dp0start-tauri.spec"

if errorlevel 1 (
  echo.
  echo [错误] 打包失败，请查看上方输出。
  if /I not "%~1"=="no-pause" pause
  exit /b 1
)

echo.
echo ==========================================================
echo   打包完成
echo   产物: %PROJECT_ROOT%\start-tauri-dev\start-tauri-dev.exe
echo.
echo   双击即用：走 tauri dev（Rust 热重载），无需 --tauri-dev 参数。
echo   若要改回默认行为，重新运行 tools\build-launcher.bat 生成 start-tauri.exe。
echo ==========================================================
echo.
if /I not "%~1"=="no-pause" pause
