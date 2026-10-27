[CmdletBinding()]
param()
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$TOOLS_DIR = Split-Path -Parent $PSScriptRoot
$PROJECT_ROOT = Split-Path -Parent $TOOLS_DIR
Set-Location $PROJECT_ROOT

. "$PSScriptRoot\Log-Common.ps1"
Initialize-Log "build-all.log"

Log "=========================================================="
Log "  Comfy APP - 一键发布构建"
Log "=========================================================="
Log "  打安装包（pnpm tauri build）→ 发布到常驻目录（留最近 2 份）"
Log "  口径见规范 launch-and-build.md §7.0 与 §7.7"
Log "=========================================================="
Log ""

function Test-Command {
    param([string]$Name)
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

. "$PSScriptRoot\Build-Guard.ps1"

# 整轮发布构建的总耗时（子步骤自己也会打印本步耗时，这里只报总账）。
$totalWatch = Start-LogStopwatch

if (-not (Test-Command pnpm)) {
    Log "[错误] 未找到 pnpm。请先安装 pnpm：corepack enable"
    Open-Log
    exit 1
}
if (-not (Test-Command cargo)) {
    Log "[错误] 未找到 cargo / Rust 工具链。请先安装 Rust：https://rustup.rs/"
    Open-Log
    exit 1
}

Log "[1/3] 前置检查：目标壳是否仍在运行"
# tauri build 收尾要覆盖 target\release\app.exe 并往里嵌资源，被上一轮启动的桌面壳
# 占用时会在编译收尾报「拒绝访问 (os error 5)」—— 那一刻整条链的账已经花完。
if ((Assert-ShellNotRunning -ProjectRoot $PROJECT_ROOT -Purpose "一键发布构建") -ne 0) {
    Open-Log
    exit 1
}
Log "  未发现正在运行的桌面壳，继续。"
Log ""

Log "[2/3] pnpm tauri build（内含 build-desktop.mjs → pnpm build → cargo 编译 → bundle）..."
# 这一格就是「打桌包」的唯一执行者：`beforeBuildCommand` 指向 build-desktop.mjs，
# 而它那条 pnpm build 链带着产物级两道防线（数产物 / 体积护栏）。这里不重抄任何一步，
# 也**不带 --no-bundle** —— 带上就回到「只有 app.exe、没有安装包」的原点（ISSUE #2503）。
Invoke-Logged "pnpm tauri build"
$buildErr = $script:LAST_INVOKE_CODE
if ($buildErr -ne 0) {
    Log ""
    Log "[错误] 安装包构建失败（exit=$buildErr），已用记事本打开日志：$LOG"
    Log "  发布那一格**没有执行** —— 本轮常驻目录里没有新的一份。"
    if ((Get-RunningShellProcess -ProjectRoot $PROJECT_ROOT).Count -gt 0) {
        Log "  注意：日志中若出现「failed to remove file ... app.exe / 拒绝访问 (os error 5)」，"
        Log "        说明桌面壳在构建期间被打开了。关闭桌面窗口后重跑本构建即可。"
    }
    Log-Elapsed -Stopwatch $totalWatch -Label "发布构建总"
    Open-Log
    exit 1
}
Log ""

Log "[3/3] 发布到常驻目录（一份一个目录 + manifest，latest.txt 是指针，轮转留 2 份）..."
# 与平台那条桌包流水线**同一个入口**（scripts/publish-desktop-bundle.mjs），不各写一遍。
# 退出码三态：0 发布完成 / 1 没有成品 / 2 没有结论（问不出常驻根或盘不够）—— 后两档
# 都不许被读成「今天没有新包」。
Invoke-Logged "node scripts/publish-desktop-bundle.mjs"
$publishErr = $script:LAST_INVOKE_CODE
if ($publishErr -ne 0) {
    Log ""
    if ($publishErr -eq 2) {
        Log "[没有结论] 发布那一格没能落盘（exit=2）：安装包在 "
        Log "  $PROJECT_ROOT\src-tauri\target\release\bundle 里，但常驻目录没有新的一份。"
        Log "  上一段给的是「为什么问不出来」，照它修完重跑本步即可（不必重新构建）。"
    } else {
        Log "[错误] 发布失败（exit=$publishErr），详情见上面那段。"
    }
    Log-Elapsed -Stopwatch $totalWatch -Label "发布构建总"
    Open-Log
    exit 1
}

Log ""
Log "=========================================================="
Log "  全部完成"
Log ("  总耗时：{0}" -f (Format-Elapsed -Elapsed $totalWatch.Elapsed))
Log "  壳      : $PROJECT_ROOT\src-tauri\target\release\app.exe（可双击启动，或用入口 tools\start\start-tauri.ps1）"
Log "  安装包  : $PROJECT_ROOT\src-tauri\target\release\bundle"
Log "  常驻目录: 见上面那行「[发布] 已落 …」（latest.txt 是指针文件，只留最近 2 份）"
Log "=========================================================="
Log ""
