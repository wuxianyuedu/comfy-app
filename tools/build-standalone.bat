@echo off
chcp 936 >nul
setlocal

cd /d "%~dp0.."
set "PROJECT_ROOT=%CD%"
set "LOG=%PROJECT_ROOT%\build-standalone.log"
if exist "%LOG%" del "%LOG%"

call :log ==========================================================
call :log   Comfy APP - 构建独立模式（standalone）壳
call :log ==========================================================
call :log   项目根目录: %PROJECT_ROOT%
call :log.

call :log ---- 1. 检查 cargo / rustc / pnpm ----
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
where pnpm >nul 2>&1
if errorlevel 1 (
  call :log [错误] 未找到 pnpm。请先安装 pnpm：corepack enable
  pause
  exit /b 1
)

call :log [1/2] 环境检查
call :run cargo --version
call :run rustc --version
call :run pnpm --version
call :log.

call :log ---- 2. 完整生产构建（standalone，含 beforeBuildCommand 组装 static）----
call :log     必须在项目根运行（tauri CLI 在项目根可解析；src-tauri 下会找不到命令）
call :log [2/2] 开始 tauri build --no-bundle（首次耗时较长：pnpm build + cargo build + 资源拷贝）...
call :log.
call pnpm tauri build --no-bundle >> "%LOG%" 2>&1
set "BUILD_ERR=%errorlevel%"

if %BUILD_ERR% neq 0 (
  call :log.
  call :log [错误] 独立模式构建失败（exit=%BUILD_ERR%），已用记事本打开日志：%LOG%
  notepad "%LOG%"
  pause
  exit /b 1
)

call :log.
call :log ==========================================================
call :log   构建完成（独立模式）
call :log   壳      : %PROJECT_ROOT%\src-tauri\target\release\app.exe
call :log   资源    : %PROJECT_ROOT%\src-tauri\target\release\ 下 server.js / .next / binaries
call :log.
call :log   配套启动入口：双击 start-tauri-standalone.exe
call :log   （若尚未打包，请运行 tools\build-launcher-standalone.bat）
call :log ==========================================================
call :log.
pause
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
