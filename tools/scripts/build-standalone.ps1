[CmdletBinding()]
param()
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$TOOLS_DIR = Split-Path -Parent $PSScriptRoot
$PROJECT_ROOT = Split-Path -Parent $TOOLS_DIR
Set-Location $PROJECT_ROOT

function Test-Command {
    param([string]$Name)
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

. "$PSScriptRoot\Log-Common.ps1"
Initialize-Log "build-standalone.log"

Log "=========================================================="
Log "  Comfy APP - 构建独立模式（standalone）壳"
Log "=========================================================="
Log "  项目根目录: $PROJECT_ROOT"
Log ""

if (-not (Test-Command cargo)) {
    Log "[错误] 未找到 cargo / Rust 工具链。请先安装 Rust：https://rustup.rs/"
    Open-Log
    exit 1
}
if (-not (Test-Command rustc)) {
    Log "[错误] 未找到 rustc。请确认 Rust 工具链已正确安装并加入 PATH。"
    Open-Log
    exit 1
}
if (-not (Test-Command pnpm)) {
    Log "[错误] 未找到 pnpm。请先安装 pnpm：corepack enable"
    Open-Log
    exit 1
}

Log "[1/2] 环境检查"
Log "  cargo : $(cargo --version 2>&1)"
Log "  rustc : $(rustc --version 2>&1)"
Log "  pnpm  : $(pnpm --version 2>&1)"
Log ""

Log "[2/2] 开始 tauri build --no-bundle（首次耗时较长：pnpm build + cargo build + 资源拷贝）..."
Invoke-Logged "pnpm tauri build --no-bundle"
$buildErr = $script:LAST_INVOKE_CODE
if ($buildErr -ne 0) {
    Log ""
    Log "[错误] 独立模式构建失败（exit=$buildErr），已用记事本打开日志：$LOG"
    Open-Log
    exit 1
}

Log ""
Log "=========================================================="
Log "  构建完成（独立模式）"
Log "  壳      : $PROJECT_ROOT\src-tauri\target\release\app.exe"
Log "  资源    : $PROJECT_ROOT\src-tauri\target\release\ 下 server.js / .next / binaries"
Log ""
Log "  配套启动入口：双击 start-tauri-standalone.exe"
Log "  （若尚未打包，请运行 tools\build\build-launcher-standalone.ps1）"
Log "=========================================================="
Log ""
