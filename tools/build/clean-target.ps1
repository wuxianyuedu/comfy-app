#Requires -Version 5.1
<#
clean-target.ps1 — 清理 Rust 构建产物（src-tauri/target），腾出磁盘空间

用法：
  双击 <项目根>\tools\build\clean-target.ps1
  或在终端执行：pwsh -NoProfile -ExecutionPolicy Bypass -File tools\build\clean-target.ps1 [-All] [-Release] [-DryRun]

档位（与 pnpm target:prune 同一套，逻辑只有一份，见规范 §9.5）：
  默认      只清各 profile 的 incremental/（删了只影响下次编译速度）
  -Release  连 release 产物整棵清（下次构建全量重编）
  -All      整棵 target（= cargo clean，下次构建全量重编）
  -DryRun   只列要删什么，不真删

跨平台等价：pnpm target:prune [--release] [--all] [--dry-run]
背景：debug + release 两份产物只增不减；cargo 撞「磁盘空间不足 os error 112」
时先跑它腾地方，别照着红改代码（规范 §5 排障手册 / ISSUE #4489）。
#>
[CmdletBinding()]
param(
    [switch]$All,
    [switch]$Release,
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

. (Join-Path $PSScriptRoot "..\..\scripts\entry-common.ps1")

$root = Get-ProjectRoot
Set-Location $root

Write-Host "[INFO] 正在清理 src-tauri/target 构建产物 ..." -ForegroundColor Cyan
Write-Host ""

$scriptArgs = @()
if ($All) { $scriptArgs += "-All" }
if ($Release) { $scriptArgs += "-Release" }
if ($DryRun) { $scriptArgs += "-DryRun" }
# 刻意不收 ValueFromRemainingArguments：-File 调用下它会把已绑定 switch 的
# token 再收一遍（实测 -DryRun 会传成 -DryRun -DryRun，ISSUE #4988 冒烟抓到），
# 本入口的档位只有上面三个 switch，透传到此为止。

$code = Invoke-Entry -Root $root -ScriptPath "tools\scripts\clean-target.ps1" -ScriptArgs $scriptArgs

if ($code -ne 0) {
    Write-Host ""
    Write-Host "[ERROR] target 清理失败，退出码 $code 。详情见 log\tools\clean-target.log" -ForegroundColor Red
}

exit (Complete-Entry -ExitCode $code -SuccessMessage "src-tauri/target 清理执行完成。")
