#Requires -Version 5.1
<#
start-tauri.ps1 — 桌面壳的**唯一**启动入口（双击即用）

说明：
  - 直接启动 <项目根>\src-tauri\target\release\app.exe，编排（起 dev server /
    端口 / 缓存 / 回收）全部由壳自己承担（见 src-tauri/src/shell_launch.rs 与
    docs/standards/launch-and-build.md §1.5）。
  - **没有再包一层启动器 exe**：Python 启动器（start-tauri*.exe）与其打包链已随
    ISSUE #784 移除，双击这一个 app.exe 就是完整形态。
  - 需要 Rust 热重载（改 src-tauri 源码）时走 start-tauri-dev.ps1。

前置：
  1. 需先编译壳：双击 tools\build\build-tauri-release.ps1，或
     cd src-tauri && cargo build --release --features custom-protocol，
     产出 src-tauri\target\release\app.exe。
  2. Windows 默认双击 .ps1 是「用记事本打开」，需先右键
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

$shellExe = Join-Path $root "src-tauri\target\release\app.exe"
if (-not (Test-Path -LiteralPath $shellExe)) {
    Write-Host "[ERROR] 未找到桌面壳：$shellExe" -ForegroundColor Red
    Write-Host "        壳是编译产物（不入库）。请先双击 tools\build\build-tauri-release.ps1，" -ForegroundColor Yellow
    Write-Host "        或执行：cd src-tauri; cargo build --release --features custom-protocol" -ForegroundColor Yellow
    exit (Complete-Entry -ExitCode 1)
}

if (-not (Test-Path -LiteralPath (Join-Path $root "node_modules\.modules.yaml"))) {
    Write-Host "[WARN] 依赖似乎还没装（缺 node_modules\.modules.yaml）。" -ForegroundColor Yellow
    Write-Host "       壳需要项目根里的 scripts\dev-launcher.mjs 与 node_modules 才能起服务，" -ForegroundColor Yellow
    Write-Host "       请先执行：pnpm install" -ForegroundColor Yellow
}

Write-Host "[INFO] 正在启动桌面壳 app.exe（唯一入口，编排由壳自己承担）..." -ForegroundColor Cyan

$proc = Start-Process -FilePath $shellExe -WorkingDirectory $root -PassThru
if ($null -eq $proc) {
    Write-Host "[ERROR] 启动失败：未能拉起 app.exe。" -ForegroundColor Red
    exit (Complete-Entry -ExitCode 1)
}

Write-Host "[OK]   已启动 app.exe（PID $($proc.Id)），启动画面出现后即可使用。" -ForegroundColor Green
exit 0
