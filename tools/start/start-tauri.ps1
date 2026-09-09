#Requires -Version 5.1
<#
start-tauri.ps1 — 无控制台窗口启动 Tauri 桌面壳（prebuilt 模式，等价于 start-tauri.exe）

说明：
  - 本入口对应 start-tauri.exe（scripts/start_tauri_launcher.py → PyInstaller 打包，
    由 tools\build\build-launcher.ps1 产出），两者行为一致：直接拉起已编译的
    target/release/app.exe，窗口秒出，后台再启动 dev server（next dev）。
  - 由本入口在隐藏窗口中调用 scripts\dev-launcher.ps1 -Prebuilt 并注入
    COMFYAPP_LAUNCH_MODE=prebuilt，Rust 壳据此加载 COMFYAPP_DEV_URL（dev server），
    不依赖 resource_dir 探测，与双击 start-tauri.exe 完全同源。
  - 适合日常使用 / 只改前端（src/ 下 TS/TSX 走 HMR 生效）。需要 Rust 壳热重载
    请用 start-tauri-dev.ps1（tauri dev）或 start-tauri-dev.exe。

前置（一次性）：Windows 默认双击 .ps1 是「用记事本打开」，需先右键
  scripts\enable-ps1-double-click.ps1 选择「使用 PowerShell 运行」完成关联。

前提：需先构建 release 壳（src-tauri\target\release\app.exe）；缺失时 dev-launcher
  会回退到 debug/app.exe 并给出提示。打包入口：tools\build\build-tauri-release.ps1。

用法：
  双击 <项目根>\tools\start\start-tauri.ps1
  或在终端执行：pwsh -NoProfile -ExecutionPolicy Bypass -File .\tools\start\start-tauri.ps1

等价入口：start-tauri.exe（tools\build\build-launcher.ps1 打包，放项目根 start-tauri\）。
#>
[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# tools\start\ → 项目根：上溯两级后点入公共库，再由它定位项目根
. (Join-Path $PSScriptRoot "..\..\scripts\entry-common.ps1")
$root = Get-ProjectRoot -StartDir $PSScriptRoot
Set-Location $root

# 与 start-tauri.exe 一致：显式声明 prebuilt 模式，让 Rust 壳走 COMFYAPP_DEV_URL，
# 而不是因资源目录存在 server.js 就误入 standalone。
$env:COMFYAPP_LAUNCH_MODE = "prebuilt"

Write-Host "[INFO] 正在后台启动 Tauri 桌面壳（prebuilt 模式，窗口秒出），请稍候..." -ForegroundColor Cyan

$proc = Invoke-Entry -ScriptPath "scripts\dev-launcher.ps1" -ScriptArgs @("-Prebuilt") -HideWindow
if ($null -eq $proc) {
    Write-Host "[ERROR] 启动失败：未能拉起 dev-launcher.ps1。" -ForegroundColor Red
    exit (Complete-Entry -ExitCode 1)
}

Write-Host "[OK]   已后台启动（PID $($proc.Id)），桌面窗口出现后即可使用。" -ForegroundColor Green
exit 0
