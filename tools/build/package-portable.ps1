#Requires -Version 5.1
<#
package-portable.ps1 — 构建入口（组装免安装版 portable zip）

用法：
  双击 <项目根>\tools\build\package-portable.ps1
  或在终端执行：pwsh -NoProfile -ExecutionPolicy Bypass -File tools\build\package-portable.ps1

前置：先跑 pnpm tauri build（或 tools\build\build-all.ps1）产出壳 / sidecar / static
      三件产物；本入口只组装，不重新构建。逻辑是跨平台的 scripts/package-desktop-portable.mjs，
      本文件只负责定位项目根 → 转交 → 透传退出码（规范 §8.4 / §9.5）。
      跨平台等价：pnpm package:portable

目的与下载说明见 docs\standards\launch-and-build.md §7.7。
#>
[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

. (Join-Path $PSScriptRoot "..\..\scripts\entry-common.ps1")

$root = Get-ProjectRoot
Set-Location $root

Write-Host "[INFO] 正在组装免安装版（portable zip）..." -ForegroundColor Cyan
Write-Host ""

$code = Invoke-Entry -Root $root -ScriptPath "tools\scripts\package-portable.ps1"

if ($code -ne 0) {
    Write-Host ""
    Write-Host "[ERROR] 免安装版组装失败，退出码 $code 。先确认跑过 pnpm tauri build。" -ForegroundColor Red
}

exit (Complete-Entry -ExitCode $code -SuccessMessage "免安装版组装完成。")
