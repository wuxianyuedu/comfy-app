#Requires -Version 5.1
<#
start-web.ps1 — 启动 Comfy-APP Web 开发模式（控制台显示日志，原 start-web.bat）

前置（一次性）：Windows 默认双击 .ps1 是「用记事本打开」，需先右键
  scripts\enable-ps1-double-click.ps1 选择「使用 PowerShell 运行」完成关联。

用法：
  双击 <项目根>\tools\start\start-web.ps1
  或在终端执行：pwsh -NoProfile -ExecutionPolicy Bypass -File .\tools\start\start-web.ps1
  参数透传：pwsh -File .\tools\start\start-web.ps1 -Args @()   （目前 dev-launcher 无必填参数）

实际逻辑在 scripts\dev-launcher.ps1（见 docs/standards/launch-and-build.md §1）。
#>
[CmdletBinding()]
param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$Args
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# tools\start\ → 项目根：上溯两级后点入公共库，再由它定位项目根
. (Join-Path $PSScriptRoot "..\..\scripts\entry-common.ps1")
$root = Get-ProjectRoot -StartDir $PSScriptRoot
Set-Location $root

Write-Host "[INFO] 启动 Comfy-APP Web 开发模式（控制台显示日志）..." -ForegroundColor Cyan
Write-Host "[INFO] 使用 PowerShell 脚本：scripts\dev-launcher.ps1" -ForegroundColor Cyan
Write-Host ""

$code = Invoke-Entry -ScriptPath "scripts\dev-launcher.ps1" -ScriptArgs $Args
if ($code -ne 0) {
    Write-Host ""
    Write-Host "[ERROR] 启动器异常退出，代码 $code" -ForegroundColor Red
}

exit (Complete-Entry -ExitCode $code)
