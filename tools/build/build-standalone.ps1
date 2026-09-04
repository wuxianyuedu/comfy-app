#Requires -Version 5.1
<#
build-standalone.ps1 — 构建入口（原 tools\build\build-standalone.bat，逻辑在 tools\scripts\build-standalone.ps1）

用法：
  双击 <项目根>\tools\build\build-standalone.ps1
  或在终端执行：pwsh -NoProfile -ExecutionPolicy Bypass -File tools\build\build-standalone.ps1

目的与前置条件见 tools\README.md 与 docs\standards\launch-and-build.md §7。
日志：log\tools\build-standalone.log
#>
[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

. (Join-Path $PSScriptRoot "..\..\scripts\entry-common.ps1")

$root = Get-ProjectRoot
Set-Location $root

Write-Host "[INFO] 正在执行 tools\scripts\build-standalone.ps1 ..." -ForegroundColor Cyan
Write-Host ""

$code = Invoke-Entry -Root $root -ScriptPath "tools\scripts\build-standalone.ps1"

if ($code -ne 0) {
    Write-Host ""
    Write-Host "[ERROR] build-standalone 失败，退出码 $code 。详情见 log\tools\build-standalone.log" -ForegroundColor Red
}

exit (Complete-Entry -ExitCode $code -SuccessMessage "build-standalone 执行完成。")
