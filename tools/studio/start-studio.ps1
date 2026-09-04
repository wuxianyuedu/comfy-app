#Requires -Version 5.1
<#
start-studio.ps1 — 启动 Drizzle Studio（原 tools\studio\start-studio.bat）

先拉起 Studio 服务、等待端口就绪，再打开浏览器前端，避免页面卡在
"Connecting to the Drizzle Kit on localhost:4983"。

前置（一次性）：Windows 默认双击 .ps1 是「用记事本打开」，需先右键
  scripts\enable-ps1-double-click.ps1 选择「使用 PowerShell 运行」完成关联。

用法：
  双击 <项目根>\tools\studio\start-studio.ps1
  或在终端执行：pwsh -NoProfile -ExecutionPolicy Bypass -File tools\studio\start-studio.ps1

依赖：已执行过 pnpm install（drizzle-kit 随 devDependencies 安装）。
逻辑在 tools\studio\start-studio.logic.ps1（入口与逻辑同名会冲突，故加 .logic 后缀）。
#>
[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

. (Join-Path $PSScriptRoot "..\..\scripts\entry-common.ps1")

$root = Get-ProjectRoot
Set-Location $root

Write-Host "[INFO] 正在启动 Drizzle Studio（http://localhost:4983）..." -ForegroundColor Cyan
Write-Host ""

$code = Invoke-Entry -Root $root -ScriptPath "tools\studio\start-studio.logic.ps1"

if ($code -ne 0) {
    Write-Host ""
    Write-Host "[ERROR] Drizzle Studio 启动失败，退出码 $code 。" -ForegroundColor Red
}

exit (Complete-Entry -ExitCode $code)
