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

Log "[3/4] 补齐编译期必需产物：启动页资源 + static 载荷目录 + Node sidecar"
# prebuilt 模式的页面由 dev server（http://127.0.0.1:3100）提供，壳里只需要启动页；
# standalone 的 server.js / .next 资源由 tools\build\build-standalone.ps1 负责。
# 过去这里在 static 缺失时会跑完整 build-desktop.mjs，而 Next standalone 的 file
# tracing 会把整个项目（node_modules / python-venv / 各构建产物）拷进 static（实测 8GB+），
# 随后被 cargo build 一起嵌进 app.exe —— 既拖慢构建又浪费空间。故改为只同步启动页。
$assetsDir = Join-Path $TAURI_DIR "splash-assets"
if (-not (Test-Path $assetsDir)) { New-Item -ItemType Directory -Force $assetsDir | Out-Null }
$splash = Join-Path $PROJECT_ROOT "public\splash.html"
if (Test-Path $splash) {
    # 与 scripts/launcher-core/splash-assets.mjs 及 src-tauri/build.rs 同判据：内容相同不写盘。
    # 无条件 Copy-Item -Force 每次构建都会刷新 mtime，而 /api/update-check 的脏检测指纹
    # 只看 mtime+size（无内容 hash），会让运行中的会话在每次构建后误报「需重编壳」。
    foreach ($name in @("splash.html", "index.html")) {
        $dest = Join-Path $assetsDir $name
        if (Test-Path $dest) {
            $srcBytes = [System.IO.File]::ReadAllBytes($splash)
            $dstBytes = [System.IO.File]::ReadAllBytes($dest)
            if ($srcBytes.Length -eq $dstBytes.Length -and
                [System.Linq.Enumerable]::SequenceEqual($srcBytes, $dstBytes)) {
                continue
            }
        }
        Copy-Item -Force $splash $dest
    }
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

# tauri.conf.json 声明 bundle.resources = ["static/"]。tauri-build 与 externalBin
# 同样地在**每次 cargo build 的编译期**校验它存在，只是 externalBin 的报错在前：
# 全新克隆 / 清理过 static 的机器上（static 是构建产物，被 .gitignore 忽略，
# ISSUE #1216 起才成为真实分发载荷），shell 侧一过就 panic：
#   tauri build failed: resource path `static` doesn't exist
# 与 sidecar 不同，这里**不能**用「随便建个空目录」糊过去：static 缺失意味着
# 本轮只想编 prebuilt 壳（standalone 载荷由 build-standalone.ps1 装配），
# 空目录只是占位，不构成载荷。装配完整时（跑过 build-desktop.mjs）就原样放行。
$resDir = Join-Path $TAURI_DIR "static"
if (-not (Test-Path $resDir)) {
    New-Item -ItemType Directory -Force $resDir | Out-Null
    Log "  已补齐空的 static 占位目录（bundle.resources 编译期校验必需）。"
    Log "  注意：这**不是**可运行载荷。要产出双击即独立运行的桌包，"
    Log "        请运行 tools\build\build-standalone.ps1（它会真装配 static）。"
} elseif (-not (Test-Path (Join-Path $resDir "server.js"))) {
    Log "  检测到 static 存在但只是占位/半成品（无 server.js），保持原样。"
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

# 构建完成后在仓库根生成启动快捷方式（指向本次产物 app.exe），省去每次去
# target\release 里翻。独立脚本 tools\start\Create-AppShortcut.ps1 也可在手动
# `cargo build --release --features custom-protocol` 之后单独运行来补生成。
$shortcutScript = Join-Path $TOOLS_DIR "start\Create-AppShortcut.ps1"
if (Test-Path $shortcutScript) {
    & $shortcutScript -ProjectRoot $PROJECT_ROOT
} else {
    Log "[警告] 未找到 $shortcutScript，跳过快捷方式生成。"
}
Log ""
Log "  这个 app.exe 就是**唯一**的启动入口：双击它即可（编排由壳自己承担）。"
Log ("  本脚本只编 release 壳（单步）。如需完整生产构建（前端一并打包、" + "双击即独立运行、不连 dev server），请运行 tools\build\build-standalone.ps1")
Log "=========================================================="
Log ""
