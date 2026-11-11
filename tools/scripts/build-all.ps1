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
Log "  打安装包（pnpm tauri build）→ 发布到项目内 dist\desktop（留最近 2 份）"
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

Log "[1/4] 前置检查：目标壳是否仍在运行"
# tauri build 收尾要覆盖 target\release\app.exe 并往里嵌资源，被上一轮启动的桌面壳
# 占用时会在编译收尾报「拒绝访问 (os error 5)」—— 那一刻整条链的账已经花完。
if ((Assert-ShellNotRunning -ProjectRoot $PROJECT_ROOT -Purpose "一键发布构建") -ne 0) {
    Open-Log
    exit 1
}
Log "  未发现正在运行的桌面壳，继续。"
Log ""

Log "[2/4] pnpm tauri build（内含 build-desktop.mjs → pnpm build → cargo 编译 → bundle）..."
# 这一格就是「打桌包」的唯一执行者：`beforeBuildCommand` 指向 build-desktop.mjs，
# 而它那条 pnpm build 链带着产物级两道防线（数产物 / 体积护栏）。这里不重抄任何一步，
# 也**不带 --no-bundle** —— 带上就回到「只有 app.exe、没有安装包」的原点（ISSUE #2503）。
Invoke-Logged "pnpm tauri build"
$buildErr = $script:LAST_INVOKE_CODE
if ($buildErr -ne 0) {
    Log ""
    Log "[错误] 安装包构建失败（exit=$buildErr），已用记事本打开日志：$LOG"
    Log "  发布那一格**没有执行** —— 本轮常驻目录里没有新的一份。"

    # 失败出口按错误码分岔（ISSUE #3468）。两族「产物被占用」长得像、处置完全不同：
    #   os error 5  桌面壳常驻占着 app.exe，锁不会自己消失，得先关窗口；
    #   os error 32 打完 nsis 立刻给 msi 二次 patch 同一个 app.exe，撞上实时防护 /
    #               索引器扫刚生成的大 exe，是瞬时共享冲突，几秒就放。
    # 旧实现只查「有没有壳」，后一族拿到的只有一句没有出口的裸错误。
    # Invoke-Logged 逐行双写，走到这里日志已落盘；读不到就只给「没有结论」，
    # 不把「没读到」当成「没有这种错误」（§13.6.3 三态口径）。
    $tailText = ""
    try {
        $tailText = (Get-Content -LiteralPath $script:LOG -Tail 200 -Encoding UTF8 -ErrorAction Stop) -join "`n"
    } catch { }
    if (-not $tailText) {
        Log "  [没有结论] 读不到构建日志尾部，错误码分岔这一格没跑起来；照上面那段真实错误归因。"
    } elseif ($tailText -match 'os error 32|另一个程序正在使用此文件') {
        Log "  定性：os error 32（产物被瞬时占用）。本仓这一族出现在 nsis 打出之后、"
        Log "        msi 二次 patch app.exe 那一跳；nsis 包通常已经生成，msi 没有。"
        Log "  处置：等几秒重跑本入口；或只补打缺的那个包，不必重跑整套编译："
        Log "        pnpm exec tauri bundle --bundles msi"
        Log "        （app.exe 与 static 载荷已在场；补完再决定要不要重跑发布那一格）"
    } elseif ((Get-RunningShellProcess -ProjectRoot $PROJECT_ROOT).Count -gt 0) {
        Log "  注意：日志中若出现「failed to remove file ... app.exe / 拒绝访问 (os error 5)」，"
        Log "        说明桌面壳在构建期间被打开了。关闭桌面窗口后重跑本构建即可。"
    }
    Log-Elapsed -Stopwatch $totalWatch -Label "发布构建总"
    Open-Log
    exit 1
}
Log ""

Log "[3/4] 在仓库根生成启动快捷方式（指向本次产物 app.exe）..."
# 与 build-tauri-release.ps1 同一步：仓库根的 Comfy APP.lnk 是双击入口，指向
# src-tauri\target\release\app.exe。ISSUE #2503 把本脚本从「调用子脚本」改成直跑
# `pnpm tauri build` 时漏掉了这次调用，根目录入口从此静默消失（回归）。
$shortcutScript = Join-Path $TOOLS_DIR "start\Create-AppShortcut.ps1"
if (Test-Path $shortcutScript) {
    & $shortcutScript -ProjectRoot $PROJECT_ROOT
} else {
    Log "[警告] 未找到 $shortcutScript，跳过快捷方式生成。"
}
Log ""

Log "[4/4] 发布到项目内 dist\desktop（一份一个目录 + manifest，latest.txt 是指针，轮转留 2 份）..."
# 发布那一格只有这一个入口（scripts/publish-desktop-bundle.mjs）——平台侧自 #3504 起走 GA
# 的 artifact + 滚动 Release，不跑它；本地这里不另写一套发布逻辑。
# `--root` 指到项目内（ISSUE #3546）：本机自己打的包不写进常驻目录，也不占别的卷；
# 不传它时该入口仍按 `pnpm store path` 推导常驻根（平台侧形态）。
# 退出码三态：0 发布完成 / 1 没有成品 / 2 没有结论（问不出发布根或盘不够）—— 后两档
# 都不许被读成「今天没有新包」。
$publishRoot = Join-Path $PROJECT_ROOT "dist\desktop"
Invoke-Logged "node scripts/publish-desktop-bundle.mjs --root `"$publishRoot`""
$publishErr = $script:LAST_INVOKE_CODE
if ($publishErr -ne 0) {
    Log ""
    if ($publishErr -eq 2) {
        Log "[没有结论] 发布那一格没能落盘（exit=2）：安装包在 "
        Log "  $PROJECT_ROOT\src-tauri\target\release\bundle 里，但 $publishRoot 没有新的一份。"
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
Log "  启动入口: $PROJECT_ROOT\Comfy APP.lnk（双击即启动，指向上面的 app.exe）"
Log "  安装包  : $PROJECT_ROOT\src-tauri\target\release\bundle"
Log "  发布目录: $publishRoot（见上面那行「[发布] 已落 …」，latest.txt 是指针文件，只留最近 2 份）"
Log "=========================================================="
Log ""
