#Requires -Version 5.1
<#
start-desktop.ps1 — 桌面版一键自检 + 启动入口（原 run-desktop.bat）

===============================================================================
面向拿到「即开即用桌面包」的普通用户：双击后会先自检桌面包是否完整，缺失时给出
中文提示；完整则自动启动桌面窗口，免手工找 exe。

此前这一步由 .bat 承担，而 cmd.exe 走系统 ANSI(GBK) 代码页，中文提示必然乱码，
因此本仓库历史上所有 .bat 都被迫做成「不含中文、不含逻辑」的哑壳。2026-09-04 起
入口统一为 .ps1（见 docs/standards/launch-and-build.md §8），中文提示与逻辑一并
收敛到这里。

前置（一次性）：Windows 默认双击 .ps1 是「用记事本打开」，需先右键
  scripts\enable-ps1-double-click.ps1 选择「使用 PowerShell 运行」完成关联。

用法：
  双击 <项目根>\tools\start\start-desktop.ps1
  或在终端执行：pwsh -NoProfile -ExecutionPolicy Bypass -File .\tools\start\start-desktop.ps1

前置条件：
  - 本入口需与桌面包在同一目录结构下（放项目根，壳在其 src-tauri\target\release\ 下）。
  - 桌面包由开发人员在 Windows 上运行 tools\build\build-standalone.ps1 产出
    （见 docs/guide-non-developer.md 第 6 节）。

退出码：0 已启动；1 自检未通过。
#>
[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# tools\start\ → 项目根：上溯两级后点入公共库，再由它定位项目根。
# 双击时 cwd 不是项目根，不能依赖它。
. (Join-Path $PSScriptRoot "..\..\scripts\entry-common.ps1")
$root = Get-ProjectRoot -StartDir $PSScriptRoot
Set-Location $root

function Say-OK   { Write-Host "[OK]   " -NoNewline -ForegroundColor Green; Write-Host "$args" }
function Say-Warn { Write-Host "[WARN] " -NoNewline -ForegroundColor Yellow; Write-Host "$args" }
function Say-Info { Write-Host "[INFO] " -NoNewline -ForegroundColor Cyan;   Write-Host "$args" }
function Say-Err  { Write-Host "[ERROR]" -NoNewline -ForegroundColor Red;    Write-Host "$args" }

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  桌面版自检与启动（Comfy APP）" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "项目目录：$root"
Write-Host ""

$fail = 0

# 1) 是否处于项目根目录（以 scripts\dev-launcher.mjs 作为目录结构标记）
# 判据刻意**不认 .ps1 入口**：编排的唯一实现是 .mjs，绑在入口形态上会在
# 换入口时静默失效一次（本仓库已栽过一回，见 launch-and-build.md §9.3）。
Say-Info "检查目录结构..."
if (-not (Test-Path -LiteralPath (Join-Path $root "scripts\dev-launcher.mjs"))) {
    Say-Err "未找到 scripts\dev-launcher.mjs —— 本入口须放在项目根目录，"
    Write-Host "         且桌面包紧邻其下的 src-tauri\target\release\ 文件夹才能工作。" -ForegroundColor Red
    Write-Host "         请把整个「即开即用桌面包」解压到不含中文/空格的目录后，再双击本入口。" -ForegroundColor Red
    $fail = 1
} else {
    Say-OK "目录结构正确。"
}

# 2) 定位桌面壳（就是 app.exe 本身：它是唯一入口，编排由壳自己承担）
$RELEASE_SHELL = Join-Path $root "src-tauri\target\release\app.exe"
$DEBUG_SHELL   = Join-Path $root "src-tauri\target\debug\app.exe"
$launcher = $null

Write-Host ""
Say-Info "查找桌面壳..."
if (Test-Path -LiteralPath $RELEASE_SHELL) {
    $launcher = $RELEASE_SHELL
    Say-OK "找到桌面壳 src-tauri\target\release\app.exe。"
} elseif (Test-Path -LiteralPath $DEBUG_SHELL) {
    $launcher = $DEBUG_SHELL
    Say-Warn "只找到 debug 壳，启动会慢一些（且改动 Rust 后需重新编译）。"
    Write-Host "         建议运行 tools\build\build-tauri-release.ps1 产出 release 壳。" -ForegroundColor Yellow
} else {
    Say-Err "未找到桌面壳（src-tauri\target\release\app.exe）。"
    Write-Host "         桌面包尚未构建。请先由开发人员在 Windows 上运行：" -ForegroundColor Red
    Write-Host "           tools\build\build-standalone.ps1   （独立版：内嵌 server，免装 Node）" -ForegroundColor Red
    Write-Host "           tools\build\build-tauri-release.ps1（开发版：需要本机 Node/pnpm）" -ForegroundColor Red
    $fail = 1
}

if ($fail -ne 0) {
    Write-Host ""
    Say-Err "自检未通过，请按上方中文提示处理。"
    if (Test-IsDoubleClicked) { Read-Host "按回车键关闭窗口" }
    exit 1
}

# 3) 自检通过，启动桌面壳
Write-Host ""
Say-Info "自检通过，正在启动桌面应用，请稍候..."
Write-Host "       （独立版内嵌 server，无需安装任何开发环境；开发版需要本机已装 Node/pnpm。）" -ForegroundColor Gray
Write-Host ""
Start-Process -FilePath $launcher -WorkingDirectory $root
exit 0
