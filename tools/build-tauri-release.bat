@echo off
chcp 936 >nul
setlocal
rem 构建 release 版 Tauri 壳（cargo build --release）
rem 产物：<项目根>\src-tauri\target\release\app.exe
rem 说明：本脚本位于 <项目根>\tools\，会自动 cd 到项目根再编译。
rem 该 release 壳启动更快，是双击 start-tauri.exe 推荐使用的预编译壳
rem （scripts/dev-launcher.ps1 的 Prebuilt 分支优先用 release/app.exe，
rem  缺失时才回退 debug/app.exe）。

cd /d "%~dp0.."
set "PROJECT_ROOT=%CD%"
set "TAURI_DIR=%PROJECT_ROOT%\src-tauri"

echo ==========================================================
echo   Comfy APP - 构建 release 版 Tauri 壳
echo ==========================================================
echo   项目根目录: %PROJECT_ROOT%
echo   编译目录:   %TAURI_DIR%
echo.

rem ---- 1. 检查 cargo / rustc ----
where cargo >nul 2>&1
if errorlevel 1 (
  echo [错误] 未找到 cargo / Rust 工具链。请先安装 Rust 并加入 PATH：
  echo.
  echo        https://rustup.rs/
  echo.
  pause
  exit /b 1
)

echo [1/2] 环境检查
cargo --version
rustc --version
echo.

rem ---- 2. 构建 release ----
echo [2/2] 开始构建 release Tauri 壳（首次耗时较长，可能 5-15 分钟）...
pushd "%TAURI_DIR%"
cargo build --release
set "BUILD_ERR=%errorlevel%"
popd

if %BUILD_ERR% neq 0 (
  echo.
  echo [错误] 构建失败，请查看上方 cargo 输出。
  pause
  exit /b 1
)

echo.
echo ==========================================================
echo   构建完成
echo   产物: %TAURI_DIR%\target\release\app.exe
echo.
echo   之后打包 start-tauri.exe 时，Prebuilt 模式会自动优先使用该壳。
echo   如需完整发布构建，请运行 tools\build-all.bat
echo ==========================================================
echo.
pause
