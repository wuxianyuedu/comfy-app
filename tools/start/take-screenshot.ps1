﻿#Requires -Version 5.1
<#
take-screenshot.ps1 — 给「改完 UI 要一张改后真实运行截图」用（Windows 双击入口）

作用：把当前运行中的应用（或自己起一个）按指定路由截成 PNG，明暗两态各一张，
并把本机路径打印出来（上传到诉求单走现成命令 cnb issues upload-image）。

实际逻辑在 scripts\screenshot.mjs（跨平台唯一实现，见
docs\standards\launch-and-build.md §9.5），本入口只负责「定位项目根 → 转交 → 透传退出码」。

用法：
  双击 <项目根>\tools\start\take-screenshot.ps1
  或在终端执行：pwsh -NoProfile -ExecutionPolicy Bypass -File .\tools\start\take-screenshot.ps1 [路由] [选项]

  选项与 pnpm screenshot 相同（--theme / --out / --full-page / --no-server …），
  详见 pnpm screenshot --help 或 docs\guides\ui-screenshot.md。

前置：
  · 本机需先装好 Node + pnpm，并已在项目根执行过 pnpm install；
  · 浏览器二进制需装过一次：pnpm exec playwright install chromium chromium-headless-shell
    （缺件时本入口会把这条命令原样打出来）。
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
    Write-Host "[ERROR] 未找到 node：截图需要 Node.js 22+。" -ForegroundColor Red
    Write-Host "        安装后重试，或直接运行 pnpm screenshot。" -ForegroundColor Red
    exit 1
}

$script = Join-Path $root "scripts\screenshot.mjs"
if (-not (Test-Path -LiteralPath $script)) {
    Write-Host "[ERROR] 未找到 scripts\screenshot.mjs（截图的跨平台实现）。" -ForegroundColor Red
    exit 1
}

Write-Host "[INFO] 正在截「改后真实运行」界面（明暗两态各一张）..." -ForegroundColor Cyan
Write-Host "[INFO] 底层脚本：scripts\screenshot.mjs" -ForegroundColor Cyan
Write-Host ""

# 命令行回显：入口经 Start-Process 起进程后命令行不再出现在窗口里，
# 回显一行即可让「这次双击到底跑了什么」有据可查（与 .mjs 侧同一 `>>> ` 前缀）。
$argList = @($script) + $ScriptArgs
Write-Host ">>> node `"$script`" $($ScriptArgs -join ' ')" -ForegroundColor Yellow
$proc = Start-Process -FilePath $node.Source -ArgumentList $argList `
  -WorkingDirectory $root -NoNewWindow -Wait -PassThru

if ($proc.ExitCode -ne 0) {
    Write-Host ""
    Write-Host "[ERROR] 截图未完成，退出码 $($proc.ExitCode)" -ForegroundColor Red
    Write-Host "        常见原因：应用没起来（缺 .env 时先跑 pnpm env:init）；浏览器没装（见上方提示）。" -ForegroundColor Red
}

exit (Complete-Entry -ExitCode ([int]$proc.ExitCode))
