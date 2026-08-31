@echo off
chcp 936 >nul
setlocal
rem 本文件以 GBK(936) 保存 —— cmd 默认按系统 ANSI 代码页解析 bat。
rem ============================================================================
rem  build-standalone.bat — 构建「独立模式」Tauri 壳（standalone）
rem
rem  职责：运行 pnpm tauri build --no-bundle，产出
rem        <项目根>\src-tauri\target\release\app.exe
rem        以及同级 standalone 资源（server.js / .next/static / binaries/node.exe）。
rem        app.exe 运行时 resource_dir 指向该目录，server.js 在根，因此走
rem        内置 Node sidecar 模式，不依赖 dev server，双击即独立运行。
rem
rem  与 build-tauri-release.bat 的区别：
rem    - build-tauri-release 只 cargo build --release，app.exe 不内嵌 standalone 资源，
rem      运行时回退 dev server（prebuilt 模式用）；
rem    - 本脚本走 tauri build（含 beforeBuildCommand 组装 static + 完整生产构建），
rem      产出真正可独立分发的壳，配合 start-tauri-standalone.exe 使用。
rem
rem  如需带安装包（msi/nsis）的发布形式，去掉下方 --no-bundle 即可。
rem ============================================================================

cd /d "%~dp0.."
set "PROJECT_ROOT=%CD%"
set "TAURI_DIR=%PROJECT_ROOT%\src-tauri"

echo ==========================================================
echo   Comfy APP - 构建独立模式（standalone）壳
echo ==========================================================
echo   项目根目录: %PROJECT_ROOT%
echo.

rem ---- 1. 检查 cargo / node / pnpm ----
where cargo >nul 2>&1
if errorlevel 1 (
  echo [错误] 未找到 cargo / Rust 工具链。请先安装 Rust：https://rustup.rs/
  if /I not "%~1"=="no-pause" pause
  exit /b 1
)
where pnpm >nul 2>&1
if errorlevel 1 (
  echo [错误] 未找到 pnpm。请先安装 pnpm：corepack enable
  if /I not "%~1"=="no-pause" pause
  exit /b 1
)

echo [1/2] 环境检查
cargo --version
pnpm --version
echo.

rem ---- 2. 完整生产构建（standalone，含 beforeBuildCommand 组装 static）----
echo [2/2] 开始 tauri build --no-bundle（首次耗时较长：pnpm build + cargo build + 资源拷贝）...
pushd "%TAURI_DIR%"
pnpm tauri build --no-bundle
set "BUILD_ERR=%errorlevel%"
popd

if %BUILD_ERR% neq 0 (
  echo.
  echo [错误] 独立模式构建失败，请查看上方输出。
  if /I not "%~1"=="no-pause" pause
  exit /b 1
)

echo.
echo ==========================================================
echo   构建完成（独立模式）
echo   壳      : %TAURI_DIR%\target\release\app.exe
echo   资源    : %TAURI_DIR%\target\release\ 下 server.js / .next / binaries
echo.
echo   配套启动入口：双击 start-tauri-standalone.exe
echo   （若尚未打包，请运行 tools\build-launcher-standalone.bat）
echo ==========================================================
echo.
if /I not "%~1"=="no-pause" pause
