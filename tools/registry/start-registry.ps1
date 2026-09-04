#Requires -Version 5.1
<#
start-registry.ps1 — 启动本地 shadcn 团队 Registry 服务（原 tools\registry\start-registry.bat）

Registry 内容位于 D:\dev\Comfy-APP-T3\registry（与本项目仓库分开），
启动后供 `pnpm dlx shadcn add @comfy-app-t3/*` 使用。
服务地址：http://127.0.0.1:3874 （端口被占用时提示已在运行）。

用法：
  双击 <项目根>\tools\registry\start-registry.ps1
  或在终端执行：pwsh -NoProfile -ExecutionPolicy Bypass -File tools\registry\start-registry.ps1

详见 docs\standards\16-shadcn-ui与表单校验.md。
#>
[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

. (Join-Path $PSScriptRoot "..\..\scripts\entry-common.ps1")

$root = Get-ProjectRoot
Set-Location $root

Write-Host "[INFO] 正在启动本地 shadcn Registry（http://127.0.0.1:3874）..." -ForegroundColor Cyan
Write-Host ""

$code = Invoke-Entry -Root $root -ScriptPath "tools\scripts\start-registry.ps1"

if ($code -ne 0) {
    Write-Host ""
    Write-Host "[ERROR] Registry 启动失败，退出码 $code 。" -ForegroundColor Red
}

exit (Complete-Entry -ExitCode $code -SuccessMessage "Registry 服务已退出。")
