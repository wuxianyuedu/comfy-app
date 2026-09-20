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
. "$PSScriptRoot\Build-Guard.ps1"
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

Log "[1/4] 环境检查"
Log "  cargo : $(cargo --version 2>&1)"
Log "  rustc : $(rustc --version 2>&1)"
Log ""

Log "[2/4] 前置检查：目标壳是否仍在运行"
# cargo 链接前会删除旧的 target\release\app.exe，被上一轮启动的桌面壳占用时
# 会在编译收尾阶段报「拒绝访问 (os error 5)」。提前拦下，省掉整轮编译。
if ((Assert-ShellNotRunning -ProjectRoot $PROJECT_ROOT -Purpose "构建 release 壳") -ne 0) {
    Open-Log
    exit 1
}
Log "  未发现正在运行的桌面壳，继续。"
Log ""

Log "[3/4] 同步启动页资源 + 补齐 Node sidecar（编译期校验必需）"
# prebuilt 模式的页面由 dev server（http://127.0.0.1:3100）提供，壳里只需要启动页；
# standalone 的 server.js / .next 资源由 tools\build\build-standalone.ps1 负责。
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
# tauri.conf.json 声明 bundle.externalBin = ["binaries/node"]，tauri-build 在每次
# cargo build 的编译期都会校验 src-tauri/binaries/node-<target-triple>.exe 存在——
# 即便 prebuilt 壳运行时用不到 sidecar 也绕不开。binaries/ 被 src-tauri/.gitignore
# 忽略不入库，全新克隆或清理后必然缺失，编译开局即 panic
# （resource path binaries\node-<triple>.exe doesn't exist）。
# 这里与 build-desktop.mjs 第 3/4 步同样地用当前 Node 运行时补齐，仅缺失时复制。
$binDir = Join-Path $TAURI_DIR "binaries"
$triple = if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "aarch64-pc-windows-msvc" } else { "x86_64-pc-windows-msvc" }
$sidecar = Join-Path $binDir "node-$triple.exe"
if (-not (Test-Path $sidecar)) {
    $node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $node) {
        Log "[错误] 缺少 Node sidecar：$sidecar ，且 PATH 中没有 node，无法自动补齐。"
        Log "  安装 Node.js ≥ 22 后重跑本脚本；或手动把 node.exe 复制为上述路径。"
        Open-Log
        exit 1
    }
    New-Item -ItemType Directory -Force $binDir | Out-Null
    Copy-Item -Force $node.Source $sidecar
    Log "  已补齐 Node sidecar：node-$triple.exe（复制自 $($node.Source)）"
}
Log ""

Log "[4/4] 开始构建 release Tauri 壳（首次耗时较长，可能 5-15 分钟）..."
$buildWatch = Start-LogStopwatch
Push-Location $TAURI_DIR
# 必须带 --features custom-protocol（见 docs/standards/launch-and-build.md §5/§7）：
# 不带则 dev/prebuilt 模式下启动页导航到 devUrl 且资源不内嵌 → 黑屏 / Edge 错误页。
Invoke-Logged "cargo build --release --features custom-protocol"
$buildErr = $script:LAST_INVOKE_CODE
Pop-Location
if ($buildErr -ne 0) {
    Log ""
    Log "[错误] 构建失败（exit=$buildErr），已用记事本打开日志：$LOG"
    Log-Elapsed -Stopwatch $buildWatch -Label "release 壳构建"
    if ((Get-RunningShellProcess -ProjectRoot $PROJECT_ROOT).Count -gt 0) {
        Log ""
        Log "  注意：日志中若出现「failed to remove file ... app.exe / 拒绝访问 (os error 5)」，"
        Log "        说明桌面壳在构建期间被打开了。关闭桌面窗口后重跑本构建即可。"
    }
    Open-Log
    exit 1
}

Log ""
Log "=========================================================="
Log "  构建完成"
Log ("  耗时：{0}" -f (Format-Elapsed -Elapsed $buildWatch.Elapsed))
Log "  产物: $TAURI_DIR\target\release\app.exe"
Log ""
Log "  这个 app.exe 就是**唯一**的启动入口：双击它即可（编排由壳自己承担）。"
Log "  如需完整发布构建，请运行 tools\build\build-all.ps1"
Log "=========================================================="
Log ""
