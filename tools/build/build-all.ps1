#Requires -Version 5.1
<#
build-all.ps1 — 一键发布构建入口（原 tools\build\build-all.bat，逻辑在 tools\scripts\）

编排两步：
  1) tools\scripts\build-tauri-release.ps1 —— 构建 release 版 Tauri 壳
  2) tools\scripts\build-launcher.ps1      —— 打包 start-tauri.exe

用法：
  双击 <项目根>\tools\build\build-all.ps1
  或在终端执行：pwsh -NoProfile -ExecutionPolicy Bypass -File tools\build\build-all.ps1

详见 tools\README.md。
#>
[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

. (Join-Path $PSScriptRoot "..\..\scripts\entry-common.ps1")

$root = Get-ProjectRoot
Set-Location $root

Write-Host "[INFO] 开始一键发布构建（release 壳 + 打包 start-tauri.exe）..." -ForegroundColor Cyan
Write-Host ""

$code = Invoke-Entry -Root $root -ScriptPath "tools\scripts\build-all.ps1"

if ($code -ne 0) {
    Write-Host ""
    Write-Host "[ERROR] 发布构建失败，退出码 $code 。详情见 log\tools\build-*.log" -ForegroundColor Red
}

exit (Complete-Entry -ExitCode $code)
