@echo off
chcp 936 >nul
setlocal

cd /d "%~dp0.."
set "PROJECT_ROOT=%CD%"
set "TAURI_DIR=%PROJECT_ROOT%\src-tauri"
if not exist "%PROJECT_ROOT%\log\tool" mkdir "%PROJECT_ROOT%\log\tool" >nul 2>&1
set "LOG=%PROJECT_ROOT%\log\tool\build-tauri-release.log"
if exist "%LOG%" del "%LOG%"

call :log ==========================================================
call :log   Comfy APP - 构建 release 版 Tauri 壳
call :log ==========================================================
call :log   项目根目录: %PROJECT_ROOT%
call :log   编译目录:   %TAURI_DIR%
call :log.

call :log ---- 1. 检查 cargo / rustc ----
where cargo >nul 2>&1
if errorlevel 1 (
  call :log [错误] 未找到 cargo / Rust 工具链。请先安装 Rust：https://rustup.rs/
  pause
  exit /b 1
)
where rustc >nul 2>&1
if errorlevel 1 (
  call :log [错误] 未找到 rustc。请确认 Rust 工具链已正确安装并加入 PATH。
  pause
  exit /b 1
)

call :log [1/2] 环境检查
call :run cargo --version
call :run rustc --version
call :log.

call :log ---- 1.5 同步前端资源（避免直接 cargo build 漏掉 static 导致黑屏）----
if not exist "%TAURI_DIR%\static" (
  call :log [1.5] 未检测到 static 目录，运行完整 build-desktop.mjs（含 pnpm build + node sidecar）...
  call :run node scripts/build-desktop.mjs
  if errorlevel 1 (
    call :log [错误] build-desktop.mjs 失败，已中止。
    notepad "%LOG%"
    pause
    exit /b 1
  )
) else (
  call :log [1.5] 增量同步 splash.html / dev-launcher.ps1 / index.html（无需重新 pnpm build）...
  if exist "%PROJECT_ROOT%\public\splash.html" (
    copy /Y "%PROJECT_ROOT%\public\splash.html" "%TAURI_DIR%\static\splash.html" >> "%LOG%" 2>&1
    copy /Y "%PROJECT_ROOT%\public\splash.html" "%TAURI_DIR%\static\index.html" >> "%LOG%" 2>&1
  )
  if exist "%PROJECT_ROOT%\scripts\dev-launcher.ps1" (
    if not exist "%TAURI_DIR%\static\scripts" mkdir "%TAURI_DIR%\static\scripts"
    copy /Y "%PROJECT_ROOT%\scripts\dev-launcher.ps1" "%TAURI_DIR%\static\scripts\dev-launcher.ps1" >> "%LOG%" 2>&1
  )
)
call :log.

call :log ---- 2. 构建 release ----
call :log [2/2] 开始构建 release Tauri 壳（首次耗时较长，可能 5-15 分钟）...
pushd "%TAURI_DIR%"
cargo build --release >> "%LOG%" 2>&1
set "BUILD_ERR=%errorlevel%"
popd

if %BUILD_ERR% neq 0 (
  call :log.
  call :log [错误] 构建失败（exit=%BUILD_ERR%），已用记事本打开日志：%LOG%
  notepad "%LOG%"
  pause
  exit /b 1
)

call :log.
call :log ==========================================================
call :log   构建完成
call :log   产物: %TAURI_DIR%\target\release\app.exe
call :log.
call :log   之后打包 start-tauri.exe 时，Prebuilt 模式会自动优先使用该壳。
call :log   如需完整发布构建，请运行 tools\build-all.bat
call :log ==========================================================
call :log.
if /I not "%~1"=="no-pause" pause
exit /b

:log
echo %* >> "%LOG%" 2>&1
echo %*
goto :eof

:run
%* >> "%LOG%" 2>&1
if errorlevel 1 (
  call :log [警告] 命令失败: %*
)
goto :eof
