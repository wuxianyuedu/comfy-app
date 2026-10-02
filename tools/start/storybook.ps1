#Requires -Version 5.1
<#
storybook.ps1 — 起组件工作台 Storybook（Windows 双击入口）

给「改完 ui/ 组件想单独看一眼」的场景：双击即在本机起 Storybook，
浏览器打开 http://127.0.0.1:6006（组件按 UI/* 分组，可切 dark / light、看 a11y 报告）。

实际逻辑在 scripts\storybook.mjs（跨平台唯一实现，见
docs/standards/launch-and-build.md §9.5），本入口只负责「定位项目根 → 转交 → 透传退出码」。

前置（一次性）：Windows 默认双击 .ps1 是「用记事本打开」，需先右键
  scripts\enable-ps1-double-click.ps1 选择「使用 PowerShell 运行」完成关联。

用法：
  双击 <项目根>\tools\start\storybook.ps1
  或在终端执行：pwsh -NoProfile -ExecutionPolicy Bypass -File .\tools\start\storybook.ps1

依赖：本机需先装好 Node + pnpm，并已在项目根执行过 pnpm install。
不需要 .env —— 启动器注入了 SKIP_ENV_VALIDATION（理由见 scripts\storybook.mjs 头部）。
#>
[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# tools\start\ → 项目根：上溯两级后点入公共库，再由它定位项目根
. (Join-Path $PSScriptRoot "..\..\scripts\entry-common.ps1")
$root = Get-ProjectRoot -StartDir $PSScriptRoot
Set-Location $root

$launcher = Join-Path $root "scripts\storybook.mjs"
if (-not (Test-Path -LiteralPath $launcher)) {
  Write-Host "[ERROR] 未找到 scripts\storybook.mjs（Storybook 的跨平台启动器）。" -ForegroundColor Red
  exit 1
}

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Host "[ERROR] 未找到 node：Storybook 需要 Node.js 22+。" -ForegroundColor Red
  Write-Host "        安装后重试，或直接运行 pnpm storybook。" -ForegroundColor Red
  exit 1
}

Write-Host "[INFO] 启动组件工作台 Storybook（http://127.0.0.1:6006）..." -ForegroundColor Cyan
Write-Host "[INFO] 底层脚本：scripts\storybook.mjs" -ForegroundColor Cyan
Write-Host "[INFO] 停止：在本窗口按 Ctrl+C。" -ForegroundColor Cyan
Write-Host ""

# 命令行回显：入口经 Start-Process 起进程后命令行不再出现在窗口里，
# 回显一行即可让「这次双击到底跑了什么」有据可查（与 .mjs 侧同一 `>>> ` 前缀）。
Write-Host ">>> node `"$launcher`" dev" -ForegroundColor Yellow
$proc = Start-Process -FilePath $node.Source -ArgumentList @($launcher, "dev") `
  -WorkingDirectory $root -NoNewWindow -Wait -PassThru

if ($proc.ExitCode -ne 0) {
  Write-Host ""
  Write-Host "[ERROR] Storybook 异常退出，代码 $($proc.ExitCode)" -ForegroundColor Red
  Write-Host "        常见原因：依赖没装（先跑 pnpm install）；端口 6006 被占用。" -ForegroundColor Red
}

exit (Complete-Entry -ExitCode ([int]$proc.ExitCode))
