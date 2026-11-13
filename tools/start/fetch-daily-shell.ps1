#Requires -Version 5.1
<#
fetch-daily-shell.ps1 — 从 CNB 站内每日成品获取纯壳并补齐本地快捷方式（ISSUE #3699）

用法：
  双击 <项目根>\tools\start\fetch-daily-shell.ps1
  或在终端执行：pwsh -NoProfile -ExecutionPolicy Bypass -File .\tools\start\fetch-daily-shell.ps1

作用：
  1. 从 CNB 滚动 nightly Release 下载每日成品中的 ComfyAPP-shell.exe；
  2. 保存为 src-tauri\target\release\app.exe（正确位置与名称，父目录自动创建）；
  3. 若项目根缺少 "Comfy APP.lnk"，则生成指向该壳的快捷方式。

逻辑在 scripts/fetch-daily-shell.mjs（跨平台）；本入口只负责定位项目根、调用 node 脚本、
透传参数与退出码。跨平台等价：pnpm fetch:daily-shell
#>
[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$ScriptArgs
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

. (Join-Path $PSScriptRoot "..\..\scripts\entry-common.ps1")
$root = Get-ProjectRoot -StartDir $PSScriptRoot
Set-Location $root

Write-Host "[INFO] 正在从 CNB 每日成品获取纯壳（ComfyAPP-shell.exe -> src-tauri\target\release\app.exe）..." -ForegroundColor Cyan
Write-Host ""

$nodeArgs = @("scripts/fetch-daily-shell.mjs") + $ScriptArgs
$code = 0
try {
    & node @nodeArgs
    $code = $LASTEXITCODE
    if ($null -eq $code) { $code = 0 }
} catch {
    Write-Host "[ERROR] 启动 node 失败：$_" -ForegroundColor Red
    $code = 1
}

if ($code -ne 0) {
    Write-Host ""
    Write-Host "[ERROR] 获取每日纯壳失败，退出码 $code 。请检查网络、CNB nightly Release 是否可用，以及必要时设置 CNB_RELEASE_TOKEN/CNB_TOKEN。" -ForegroundColor Red
}

exit (Complete-Entry -ExitCode $code -SuccessMessage "每日纯壳已就位（src-tauri\target\release\app.exe），项目根快捷方式已检查/补齐。")
