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

Log "[1.5] 同步启动页资源（prebuilt 壳只需内嵌 splash.html）"
# prebuilt 模式的页面由 dev server（http://127.0.0.1:3000）提供，壳里只需要启动页；
# standalone 资源（server.js / .next / Node sidecar）由 tools\build\build-standalone.ps1 负责。
# 过去这里在 static 缺失时会跑完整 build-desktop.mjs，而 Next standalone 的 file
# tracing 会把整个项目（node_modules / python-venv / 各构建产物）拷进 static（实测 8GB+），
# 随后被 cargo build 一起嵌进 app.exe —— 既拖慢构建又浪费空间。故改为只同步启动页。
$assetsDir = Join-Path $TAURI_DIR "splash-assets"
if (-not (Test-Path $assetsDir)) { New-Item -ItemType Directory -Force $assetsDir | Out-Null }
$splash = Join-Path $PROJECT_ROOT "public\splash.html"
if (Test-Path $splash) {
    Copy-Item -Force $splash (Join-Path $TAURI_DIR "splash-assets\splash.html")
    Copy-Item -Force $splash (Join-Path $TAURI_DIR "splash-assets\index.html")
} else {
    Log "[警告] 未找到 public/splash.html，构建出的壳将缺少启动页（窗口可能黑屏）"
}
$devLauncher = Join-Path $PROJECT_ROOT "scripts\dev-launcher.ps1"
if (Test-Path $devLauncher) {
    $destScripts = Join-Path $TAURI_DIR "static\scripts"
    if (-not (Test-Path $destScripts)) { New-Item -ItemType Directory -Force $destScripts | Out-Null }
    Copy-Item -Force $devLauncher (Join-Path $destScripts "dev-launcher.ps1")
}
Log ""

Log "[2/2] 开始构建 release Tauri 壳（首次耗时较长，可能 5-15 分钟）..."
Push-Location $TAURI_DIR
# 必须带 --features custom-protocol（见 docs/standards/launch-and-build.md §5/§7）：
# 不带则 dev/prebuilt 模式下启动页导航到 devUrl 且资源不内嵌 → 黑屏 / Edge 错误页。
Invoke-Logged "cargo build --release --features custom-protocol"
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
Log "  如需完整发布构建，请运行 tools\build\build-all.ps1"
Log "=========================================================="
Log ""
