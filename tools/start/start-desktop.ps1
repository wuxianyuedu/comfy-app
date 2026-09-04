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
  - 本入口需与桌面包在同一目录结构下（放项目根，桌面包在其 start-tauri*\ 下）。
  - 桌面包由开发人员在 Windows 上运行 tools\build\build-standalone.ps1 +
    tools\build\build-launcher-standalone.ps1 产出（见 docs/guide-non-developer.md 第 6 节）。

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

# 1) 是否处于项目根目录（以 dev-launcher.ps1 作为目录结构标记）
Say-Info "检查目录结构..."
if (-not (Test-Path -LiteralPath (Join-Path $root "scripts\dev-launcher.ps1"))) {
    Say-Err "未找到 scripts\dev-launcher.ps1 —— 本入口须放在项目根目录，"
    Write-Host "         且桌面包紧邻其下的 start-tauri*\ 文件夹才能工作。" -ForegroundColor Red
    Write-Host "         请把整个「即开即用桌面包」解压到不含中文/空格的目录后，再双击本入口。" -ForegroundColor Red
    $fail = 1
} else {
    Say-OK "目录结构正确。"
}

# 2) 定位桌面启动器（优先独立版，其次 prebuilt 版）
$launcher = $null
$standalone = Join-Path $root "start-tauri-standalone\start-tauri-standalone.exe"
$prebuilt   = Join-Path $root "start-tauri\start-tauri.exe"

Write-Host ""
Say-Info "查找桌面启动器..."
if (Test-Path -LiteralPath $standalone) {
    $launcher = $standalone
    Say-OK "找到独立版桌面启动器（免装任何开发环境）。"
} elseif (Test-Path -LiteralPath $prebuilt) {
    $launcher = $prebuilt
    Say-OK "找到桌面启动器 start-tauri\start-tauri.exe。"
    Say-Warn "该入口默认以 prebuilt 模式运行，需要本机已装 Node/pnpm 并起 dev server；"
    Write-Host "         若你不是开发人员、只想要免装的成品，请让开发人员分发「独立版桌面包」。" -ForegroundColor Yellow
} else {
    Say-Err "未找到桌面启动器（start-tauri\start-tauri.exe 或独立版）。"
    Write-Host "         桌面包尚未构建。请先由开发人员在 Windows 上运行：" -ForegroundColor Red
    Write-Host "           tools\build\build-standalone.ps1           （构建独立壳）" -ForegroundColor Red
    Write-Host "           tools\build\build-launcher-standalone.ps1 （打包独立启动器）" -ForegroundColor Red
    $fail = 1
}

if ($fail -ne 0) {
    Write-Host ""
    Say-Err "自检未通过，请按上方中文提示处理。"
    if (Test-IsDoubleClicked) { Read-Host "按回车键关闭窗口" }
    exit 1
}

# 3) 自检通过，启动桌面启动器
Write-Host ""
Say-Info "自检通过，正在启动桌面应用，请稍候..."
Write-Host "       （独立版无需安装任何开发环境，稍等即弹出主窗口。）" -ForegroundColor Gray
Write-Host ""
Start-Process -FilePath $launcher -WorkingDirectory (Split-Path -Parent $launcher)
exit 0
