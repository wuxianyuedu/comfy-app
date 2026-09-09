#Requires -Version 5.1
<#
start-tauri-dev.ps1 — 无控制台窗口启动 Tauri 桌面壳（dev / tauri dev 模式）

说明：
  - 由本入口在隐藏窗口中调用 scripts\dev-launcher.ps1 -Tauri，桌面窗口由 Tauri
    自身弹出，不残留 CMD/PowerShell 控制台窗口。
  - 关闭 Tauri 桌面窗口后，dev-launcher.ps1 会用 taskkill /T 回收整棵进程树
    （见 docs/standards/launch-and-build.md §3）。
  - 本入口等价于 start-tauri-dev.exe（tools\build\build-launcher-dev.ps1 打包），
    走 pnpm tauri dev：Rust 壳改动会热重载，但首次启动需现场编译，较慢。

前置（一次性）：Windows 默认双击 .ps1 是「用记事本打开」，需先右键
  scripts\enable-ps1-double-click.ps1 选择「使用 PowerShell 运行」完成关联。

用法：
  双击 <项目根>\tools\start\start-tauri-dev.ps1
  或在终端执行：pwsh -NoProfile -ExecutionPolicy Bypass -File .\tools\start\start-tauri-dev.ps1

等价入口：start-tauri-dev.exe（tools\build\build-launcher-dev.ps1 打包）。
需要秒出窗口的日常入口请用 start-tauri.ps1 / start-tauri.exe（prebuilt 模式）。
#>
[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# tools\start\ → 项目根：上溯两级后点入公共库，再由它定位项目根
. (Join-Path $PSScriptRoot "..\..\scripts\entry-common.ps1")
$root = Get-ProjectRoot -StartDir $PSScriptRoot
Set-Location $root

Write-Host "[INFO] 正在后台启动 Tauri 桌面壳（dev / tauri dev 模式），首次需编译 Rust，请稍候..." -ForegroundColor Cyan

$proc = Invoke-Entry -ScriptPath "scripts\dev-launcher.ps1" -ScriptArgs @("-Tauri") -HideWindow
if ($null -eq $proc) {
    Write-Host "[ERROR] 启动失败：未能拉起 dev-launcher.ps1。" -ForegroundColor Red
    exit (Complete-Entry -ExitCode 1)
}

Write-Host "[OK]   已后台启动（PID $($proc.Id)），桌面窗口出现后即可使用。" -ForegroundColor Green
exit 0
