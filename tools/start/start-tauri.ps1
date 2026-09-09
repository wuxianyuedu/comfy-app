#Requires -Version 5.1
<#
start-tauri.ps1 — 直接启动打包好的 start-tauri.exe（prebuilt 桌面壳启动器）

说明：
  - 本入口直接调用 <项目根>\start-tauri\start-tauri.exe（由 scripts/start_tauri_launcher.py
    经 PyInstaller 打包的启动器，见 tools\build\build-launcher.ps1），由它拉起
    dev-launcher.ps1 -Prebuilt 并弹出 Win32 启动画面 / dev server / 单实例保护。
  - 不做任何复刻：启动画面、窗口聚焦、comfy-cli 自动准备等能力全部由 exe 自身负责，
    本入口只负责定位、调用、收尾。

前置：
  1. 需先打包 start-tauri.exe：双击 tools\build\build-launcher.ps1（或
     pyinstaller --clean --noconfirm --distpath . --workpath build-launcher tools/start-tauri.spec）。
  2. 需先编译预编译壳：cd src-tauri && cargo build --release --features custom-protocol，
     产出 src-tauri\target\release\app.exe（缺省时 exe 会回退 debug 壳或报错提示）。
  3. Windows 默认双击 .ps1 是「用记事本打开」，需先右键
     scripts\enable-ps1-double-click.ps1 选择「使用 PowerShell 运行」完成关联。

用法：
  双击 <项目根>\tools\start\start-tauri.ps1
  或在终端执行：pwsh -NoProfile -ExecutionPolicy Bypass -File .\tools\start\start-tauri.ps1
#>
[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# tools\start\ → 项目根：上溯两级后点入公共库，再由它定位项目根
. (Join-Path $PSScriptRoot "..\..\scripts\entry-common.ps1")
$root = Get-ProjectRoot -StartDir $PSScriptRoot
Set-Location $root

$launcherExe = Join-Path $root "start-tauri\start-tauri.exe"
if (-not (Test-Path -LiteralPath $launcherExe)) {
    Write-Host "[ERROR] 未找到 start-tauri.exe：$launcherExe" -ForegroundColor Red
    Write-Host "        该文件是打包产物（不入库）。请先双击 tools\build\build-launcher.ps1 打包，" -ForegroundColor Yellow
    Write-Host "        或执行：pyinstaller --clean --noconfirm --distpath . --workpath build-launcher tools/start-tauri.spec" -ForegroundColor Yellow
    exit (Complete-Entry -ExitCode 1)
}

Write-Host "[INFO] 正在启动 start-tauri.exe（prebuilt 桌面壳），启动画面弹出即可。" -ForegroundColor Cyan

$proc = Start-Process -FilePath $launcherExe -WorkingDirectory $root -PassThru
if ($null -eq $proc) {
    Write-Host "[ERROR] 启动失败：未能拉起 start-tauri.exe。" -ForegroundColor Red
    exit (Complete-Entry -ExitCode 1)
}

Write-Host "[OK]   已启动 start-tauri.exe（PID $($proc.Id)），启动画面出现后即可使用。" -ForegroundColor Green
exit 0
