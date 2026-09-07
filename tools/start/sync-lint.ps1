#Requires -Version 5.1
<#
sync-lint.ps1 — 开发日常检查入口：先同步依赖再跑 ESLint（install && lint）

给「拉取更新 / 改完代码后不确定要敲哪个命令」的场景：双击本脚本即自动
pnpm install（对齐 pnpm-lock.yaml）+ pnpm lint。完整的 typecheck / test
质量门禁另见 verify-quality.ps1。

实际逻辑在 scripts\sync-lint.ps1，本入口只负责定位项目根、调用逻辑、透传退出码。

前置（一次性）：Windows 默认双击 .ps1 是「用记事本打开」，需先右键
  scripts\enable-ps1-double-click.ps1 选择「使用 PowerShell 运行」完成关联。

用法：
  双击 <项目根>\tools\start\sync-lint.ps1
  或在终端执行：pwsh -NoProfile -ExecutionPolicy Bypass -File .\tools\start\sync-lint.ps1

依赖：本机需先装好 Node + pnpm。安装步骤细节见脚本内注释。
#>
[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# tools\start\ → 项目根：上溯两级后点入公共库，再由它定位项目根
. (Join-Path $PSScriptRoot "..\..\scripts\entry-common.ps1")
$root = Get-ProjectRoot -StartDir $PSScriptRoot
Set-Location $root

Write-Host "[INFO] 开始同步依赖并执行 ESLint 检查..." -ForegroundColor Cyan
Write-Host "[INFO] 底层脚本：scripts\sync-lint.ps1" -ForegroundColor Cyan
Write-Host ""

$code = Invoke-Entry -Root $root -ScriptPath "scripts\sync-lint.ps1"

Write-Host ""
if ($code -ne 0) {
    Write-Host "[ERROR] install/lint 未全部通过，退出码 $code 。请阅读上方提示后处理。" -ForegroundColor Red
    exit (Complete-Entry -ExitCode $code)
}
exit (Complete-Entry -ExitCode $code -SuccessMessage "依赖已同步，pnpm lint 通过。可继续开发 / 提交。")
