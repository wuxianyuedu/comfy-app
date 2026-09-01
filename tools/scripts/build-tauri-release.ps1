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
Initialize-Log "build-tauri-release.log"

$TAURI_DIR = Join-Path $PROJECT_ROOT "src-tauri"

Log "=========================================================="
Log "  Comfy APP - 构建 release 版 Tauri 壳"
Log "=========================================================="
Log "  项目根目录: $PROJECT_ROOT"
Log "  编译目录:   $TAURI_DIR"
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

Log "[1/2] 环境检查"
Log "  cargo : $(cargo --version 2>&1)"
Log "  rustc : $(rustc --version 2>&1)"
Log ""

Log "[1.5] 同步前端资源（避免直接 cargo build 漏掉 static 导致黑屏）"
$staticDir = Join-Path $TAURI_DIR "static"
if (-not (Test-Path $staticDir)) {
    Log "[1.5] 未检测到 static 目录，运行完整 build-desktop.mjs（含 pnpm build + node sidecar）..."
    Invoke-Logged "node scripts/build-desktop.mjs"
$r = $script:LAST_INVOKE_CODE
    if ($r -ne 0) {
        Log "[错误] build-desktop.mjs 失败，已中止。"
        Open-Log
        exit 1
    }
} else {
    Log "[1.5] 增量同步 splash.html / dev-launcher.ps1 / index.html（无需重新 pnpm build）..."
    $splash = Join-Path $PROJECT_ROOT "public\splash.html"
    if (Test-Path $splash) {
        Copy-Item -Force $splash (Join-Path $TAURI_DIR "static\splash.html")
        Copy-Item -Force $splash (Join-Path $TAURI_DIR "static\index.html")
    }
    $devLauncher = Join-Path $PROJECT_ROOT "scripts\dev-launcher.ps1"
    if (Test-Path $devLauncher) {
        $destScripts = Join-Path $TAURI_DIR "static\scripts"
        if (-not (Test-Path $destScripts)) { New-Item -ItemType Directory -Force $destScripts | Out-Null }
        Copy-Item -Force $devLauncher (Join-Path $destScripts "dev-launcher.ps1")
    }
}
Log ""

Log "[2/2] 开始构建 release Tauri 壳（首次耗时较长，可能 5-15 分钟）..."
Push-Location $TAURI_DIR
Invoke-Logged "cargo build --release"
$buildErr = $script:LAST_INVOKE_CODE
Pop-Location
if ($buildErr -ne 0) {
    Log ""
    Log "[错误] 构建失败（exit=$buildErr），已用记事本打开日志：$LOG"
    Open-Log
    exit 1
}

Log ""
Log "=========================================================="
Log "  构建完成"
Log "  产物: $TAURI_DIR\target\release\app.exe"
Log ""
Log "  之后打包 start-tauri.exe 时，Prebuilt 模式会自动优先使用该壳。"
Log "  如需完整发布构建，请运行 tools\build-all.bat"
Log "=========================================================="
Log ""
