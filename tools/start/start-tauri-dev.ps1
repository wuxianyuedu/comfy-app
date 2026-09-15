#Requires -Version 5.1
<#
start-tauri-dev.ps1 — 无控制台窗口启动 Tauri 桌面壳（dev / tauri dev 模式，Rust 热重载）

说明：
  - 由本入口在隐藏窗口中调用 scripts\dev-launcher.ps1 -Tauri，桌面窗口由 Tauri
    自身弹出，不残留 CMD/PowerShell 控制台窗口。
  - 走 pnpm tauri dev，Rust 壳现编译（debug，首次数分钟）；改 Rust 自动重载，
    适合开发桌面壳本身逻辑（lib.rs / 窗口配置）。
  - 关闭 Tauri 桌面窗口后，整棵进程树由编排器回收（Windows 走 taskkill /T /F、
    POSIX 走进程组信号，判据收在 src/lib/kill-process-tree.ts）——
    **入口与 dev-launcher.ps1 都不拼平台命令**，见 launch-and-build.md §3。

前置（一次性）：Windows 默认双击 .ps1 是「用记事本打开」，需先右键
  scripts\enable-ps1-double-click.ps1 选择「使用 PowerShell 运行」完成关联。

用法：
  双击 <项目根>\tools\start\start-tauri-dev.ps1
  或在终端执行：pwsh -NoProfile -ExecutionPolicy Bypass -File .\tools\start\start-tauri-dev.ps1

等价入口：start-tauri-dev.exe（tools\build\build-launcher-dev.ps1 打包）。
#>
[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# tools\start\ → 项目根：上溯两级后点入公共库，再由它定位项目根
. (Join-Path $PSScriptRoot "..\..\scripts\entry-common.ps1")
$root = Get-ProjectRoot -StartDir $PSScriptRoot
Set-Location $root

Write-Host "[INFO] 正在后台启动 Tauri 桌面壳（dev 模式，Rust 热重载），请稍候弹出窗口..." -ForegroundColor Cyan

$proc = Invoke-Entry -ScriptPath "scripts\dev-launcher.ps1" -ScriptArgs @("-Tauri") -HideWindow
if ($null -eq $proc) {
    Write-Host "[ERROR] 启动失败：未能拉起 dev-launcher.ps1。" -ForegroundColor Red
    exit (Complete-Entry -ExitCode 1)
}

Write-Host "[OK]   已后台启动（PID $($proc.Id)），桌面窗口出现后即可使用。" -ForegroundColor Green
exit 0
