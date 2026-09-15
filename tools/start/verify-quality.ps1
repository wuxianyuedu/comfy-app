#Requires -Version 5.1
<#
verify-quality.ps1 — 一键质量门禁（原 verify-quality.bat）

默认跑全部三项：typecheck / eslint（零警告） / vitest（排除已知基线失败）。
实际逻辑在 scripts\quality-gate.ps1，本入口只负责定位项目根、透传 -Mode 与退出码。

前置（一次性）：Windows 默认双击 .ps1 是「用记事本打开」，需先右键
  scripts\enable-ps1-double-click.ps1 选择「使用 PowerShell 运行」完成关联。

用法：
  双击 <项目根>\tools\start\verify-quality.ps1                全部三项
  或在终端执行：
    pwsh -File .\tools\start\verify-quality.ps1
    pwsh -File .\tools\start\verify-quality.ps1 -Mode typecheck
    pwsh -File .\tools\start\verify-quality.ps1 -Mode lint
    pwsh -File .\tools\start\verify-quality.ps1 -Mode test

依赖：本机需先装好 Node + pnpm，并已在项目根执行过 `pnpm install`。
失败定位与「新增校验怎么补」见 scripts\quality-gate.ps1 头部注释与规范 11.12。
#>
[CmdletBinding()]
param(
  [ValidateSet("typecheck", "lint", "format", "test", "all")]
  [string]$Mode = "all"
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# tools\start\ → 项目根：上溯两级后点入公共库，再由它定位项目根
. (Join-Path $PSScriptRoot "..\..\scripts\entry-common.ps1")
$root = Get-ProjectRoot -StartDir $PSScriptRoot
Set-Location $root

if (-not (Test-Path -LiteralPath (Join-Path $root "node_modules\.bin"))) {
    Write-Host "[ERROR] 未检测到 node_modules\.bin。" -ForegroundColor Red
    Write-Host "        请先在项目根目录执行：pnpm install" -ForegroundColor Red
    exit (Complete-Entry -ExitCode 1)
}

Write-Host "[INFO] 开始质量验证，模式：$Mode （typecheck/lint/test/all）" -ForegroundColor Cyan
Write-Host "[INFO] 底层脚本：scripts\quality-gate.ps1" -ForegroundColor Cyan
Write-Host ""

$code = Invoke-Entry -Root $root -ScriptPath "scripts\quality-gate.ps1" -ScriptArgs @("-Mode", $Mode)

Write-Host ""
if ($code -ne 0) {
    Write-Host "[ERROR] 质量门禁失败，退出码 $code" -ForegroundColor Red
    Write-Host "        请查看上方失败步骤，修复后重新双击本入口。" -ForegroundColor Red
} else {
    Write-Host "[OK] 全部质量门禁通过。" -ForegroundColor Green
}

exit (Complete-Entry -ExitCode $code)
