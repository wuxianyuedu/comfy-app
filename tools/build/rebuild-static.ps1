#Requires -Version 5.1
<#
rebuild-static.ps1 — 构建入口（原 tools\build\rebuild-static.bat，逻辑在 tools\scripts\rebuild-static.ps1）

用法：
  双击 <项目根>\tools\build\rebuild-static.ps1
  或在终端执行：pwsh -NoProfile -ExecutionPolicy Bypass -File tools\build\rebuild-static.ps1

目的与前置条件见 tools\README.md 与 docs\standards\launch-and-build.md §7。
日志：log\tools\rebuild-static.log
#>
[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

. (Join-Path $PSScriptRoot "..\..\scripts\entry-common.ps1")

$root = Get-ProjectRoot
Set-Location $root

Write-Host "[INFO] 正在执行 tools\scripts\rebuild-static.ps1 ..." -ForegroundColor Cyan
Write-Host ""

$code = Invoke-Entry -Root $root -ScriptPath "tools\scripts\rebuild-static.ps1"

if ($code -ne 0) {
    Write-Host ""
    Write-Host "[ERROR] rebuild-static 失败，退出码 $code 。详情见 log\tools\rebuild-static.log" -ForegroundColor Red
}

exit (Complete-Entry -ExitCode $code -SuccessMessage "rebuild-static 执行完成。")
