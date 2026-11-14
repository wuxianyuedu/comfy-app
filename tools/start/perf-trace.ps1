#Requires -Version 5.1
<#
perf-trace.ps1 — 给「定位性能 / 冻结类问题要一段主线程 trace」用（Windows 双击入口）

作用：把当前运行中的应用（或自己起一个）按指定路由录一段 Chrome DevTools trace
（含主线程任务与 CPU 采样），按次命名落 log\profiles\，并把本机路径与「怎么读」
打印出来。

实际逻辑在 scripts\perf-trace.mjs（跨平台唯一实现，见
docs\standards\launch-and-build.md §9.5），本入口只负责「定位项目根 → 转交 → 透传退出码」。

用法：
  双击 <项目根>\tools\start\perf-trace.ps1
  或在终端执行：pwsh -NoProfile -ExecutionPolicy Bypass -File .\tools\start\perf-trace.ps1 [路由] [选项]

  选项与 pnpm perf:trace 相同（--settle / --click / --out / --no-server …），
  详见 pnpm perf:trace --help 或 docs\guides\perf-trace.md。

前置：
  · 本机需先装好 Node + pnpm，并已在项目根执行过 pnpm install；
  · 浏览器二进制需装过一次：pnpm exec playwright install chromium chromium-headless-shell
    （缺件时本入口会把这条命令原样打出来）。

边界：trace 有开销，会污染被测页面 —— 按需取证用，别挂在常驻轮询里，也不进 CI。
#>
[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$ScriptArgs
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

. (Join-Path $PSScriptRoot "..\..\scripts\entry-common.ps1")
$root = Get-ProjectRoot -StartDir $PSScriptRoot
Set-Location $root

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    Write-Host "[ERROR] 未找到 node：性能取证需要 Node.js 22+。" -ForegroundColor Red
    Write-Host "        安装后重试，或直接运行 pnpm perf:trace。" -ForegroundColor Red
    exit 1
}

$script = Join-Path $root "scripts\perf-trace.mjs"
if (-not (Test-Path -LiteralPath $script)) {
    Write-Host "[ERROR] 未找到 scripts\perf-trace.mjs（性能取证的跨平台实现）。" -ForegroundColor Red
    exit 1
}

Write-Host "[INFO] 正在录性能 trace（加载 + 静置一段，含主线程任务与 CPU 采样）..." -ForegroundColor Cyan
Write-Host "[INFO] 底层脚本：scripts\perf-trace.mjs" -ForegroundColor Cyan
Write-Host ""

# 命令行回显：入口经 Start-Process 起进程后命令行不再出现在窗口里，
# 回显一行即可让「这次双击到底跑了什么」有据可查（与 .mjs 侧同一 `>>> ` 前缀）。
$argList = @($script) + $ScriptArgs
Write-Host ">>> node `"$script`" $($ScriptArgs -join ' ')" -ForegroundColor Yellow
$proc = Start-Process -FilePath $node.Source -ArgumentList $argList `
  -WorkingDirectory $root -NoNewWindow -Wait -PassThru

if ($proc.ExitCode -ne 0) {
    Write-Host ""
    Write-Host "[ERROR] 性能取证未完成，退出码 $($proc.ExitCode)" -ForegroundColor Red
    Write-Host "        常见原因：应用没起来（缺 .env 时先跑 pnpm env:init）；浏览器没装（见上方提示）。" -ForegroundColor Red
}

exit (Complete-Entry -ExitCode ([int]$proc.ExitCode))
