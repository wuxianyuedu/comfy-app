#Requires -Version 5.1
<#
run-local.ps1 — 非开发人员本地运行引导入口（原 run-local.bat）

一键完成环境自检与初始化：检查 node/pnpm → 生成 .env → 补齐依赖，
完成后提示双击 start-web.ps1 启动。实际逻辑在 scripts\prepare-local-run.ps1。

前置（一次性）：Windows 默认双击 .ps1 是「用记事本打开」，需先右键
  scripts\enable-ps1-double-click.ps1 选择「使用 PowerShell 运行」完成关联。

用法：
  双击 <项目根>\tools\start\run-local.ps1
  或在终端执行：pwsh -NoProfile -ExecutionPolicy Bypass -File .\tools\start\run-local.ps1

详见 docs/guide-non-developer.md 第 4 节。
#>
[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# tools\start\ → 项目根：上溯两级后点入公共库，再由它定位项目根
. (Join-Path $PSScriptRoot "..\..\scripts\entry-common.ps1")
$root = Get-ProjectRoot -StartDir $PSScriptRoot
Set-Location $root

Write-Host "[INFO] 正在执行本地运行环境自检与初始化..." -ForegroundColor Cyan
Write-Host "[INFO] 调用 PowerShell 脚本：scripts\prepare-local-run.ps1" -ForegroundColor Cyan
Write-Host ""

$code = Invoke-Entry -ScriptPath "scripts\prepare-local-run.ps1"
if ($code -ne 0) {
    Write-Host ""
    Write-Host "[ERROR] 初始化未完成，代码 $code 。请阅读上方中文提示。" -ForegroundColor Red
}

exit (Complete-Entry -ExitCode $code)
