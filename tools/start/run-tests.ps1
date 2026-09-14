#Requires -Version 5.1
<#
run-tests.ps1 — 只想跑测试时的专用入口（原质量门禁只提供「三项一起跑」）

底层是 `pnpm exec vitest run`。与 tools\start\verify-quality.ps1 的分工：
  - verify-quality.ps1 = 一键门禁，typecheck / eslint / vitest 三项固定串联；
  - 本入口 = 只跑测试，且能带参数：指定单个文件、透传 vitest 自己的开关。

用法：
  双击 <项目根>\tools\start\run-tests.ps1                 全部测试（排除已知基线失败）
  或在终端执行：
    pwsh -File .\tools\start\run-tests.ps1                    同上
    pwsh -File .\tools\start\run-tests.ps1 -Full             连已知基线失败文件一起跑
    pwsh -File .\tools\start\run-tests.ps1 src\lib\media.test.ts
    pwsh -File .\tools\start\run-tests.ps1 -- --reporter=verbose

-Full 与「已知基线失败」的含义、"新增校验怎么补"见 scripts\run-tests.ps1 头部注释
与 docs\standards\11-测试与可观测性.md 的 11.12。

前置（一次性）：Windows 默认双击 .ps1 是「用记事本打开」，需先右键
  scripts\enable-ps1-double-click.ps1 选择「使用 PowerShell 运行」完成关联。

依赖：本机需先装好 Node + pnpm，并已在项目根执行过 `pnpm install`。
#>
[CmdletBinding()]
param(
  [switch]$Full,
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$Remaining
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# tools\start\ → 项目根：上溯两级后点入公共库，再由它定位项目根
. (Join-Path $PSScriptRoot "..\..\scripts\entry-common.ps1")
$root = Get-ProjectRoot -StartDir $PSScriptRoot
Set-Location $root

Write-Host "[INFO] 开始运行 Vitest，底层脚本：scripts\run-tests.ps1" -ForegroundColor Cyan
if ($Full) {
    Write-Host "[INFO] 全量模式（-Full）：已知基线失败文件一并运行" -ForegroundColor Cyan
}
Write-Host ""

# 透传开关与参数：-Full 转成逻辑脚本的同名开关，其余原样带上（含 -- 之后的参数）
$scriptArgs = @()
if ($Full) { $scriptArgs += "-Full" }
if ($Remaining) { $scriptArgs += @($Remaining) }

$code = Invoke-Entry -Root $root -ScriptPath "scripts\run-tests.ps1" -ScriptArgs $scriptArgs

Write-Host ""
if ($code -ne 0) {
    Write-Host "[ERROR] 测试未全部通过，退出码 $code" -ForegroundColor Red
    Write-Host "        请查看上方失败用例；只跑其中一个文件时把文件路径传进本入口即可。" -ForegroundColor Red
    exit (Complete-Entry -ExitCode $code)
}
exit (Complete-Entry -ExitCode $code -SuccessMessage "Vitest 全部通过。")
