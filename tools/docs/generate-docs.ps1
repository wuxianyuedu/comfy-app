#Requires -Version 5.1
<#
generate-docs.ps1 — 一键生成原文文档（编辑文档 → docs/generated/）

给「文档不直观、想看原文数值」的场景：双击本脚本即自动
  1. 先跑 pnpm doc:check 校验编辑文档的占位符/裸值/路径与权威源码一致；
  2. 再跑 pnpm doc:render 把占位符替换成从源码实时提取的真实值，
     输出到 docs/generated/ 供直接阅读。

实际逻辑在 scripts\generate-docs.ps1，本入口只负责定位项目根、调用逻辑、透传退出码。

前置（一次性）：Windows 默认双击 .ps1 是「用记事本打开」，需先右键
  scripts\enable-ps1-double-click.ps1 选择「使用 PowerShell 运行」完成关联。

用法：
  双击 <项目根>\tools\docs\generate-docs.ps1
  或在终端执行：pwsh -NoProfile -ExecutionPolicy Bypass -File .\tools\docs\generate-docs.ps1

依赖：本机需先装好 Node + pnpm，并已在项目根执行过 pnpm install。
#>
[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# tools\docs\ → 项目根：上溯两级后点入公共库，再由它定位项目根
. (Join-Path $PSScriptRoot "..\..\scripts\entry-common.ps1")
$root = Get-ProjectRoot -StartDir $PSScriptRoot
Set-Location $root

Write-Host "[INFO] 开始生成原文文档（doc:check + doc:render）..." -ForegroundColor Cyan
Write-Host "[INFO] 底层脚本：scripts\generate-docs.ps1" -ForegroundColor Cyan
Write-Host ""

$code = Invoke-Entry -Root $root -ScriptPath "scripts\generate-docs.ps1"

Write-Host ""
if ($code -ne 0) {
    Write-Host "[ERROR] 文档生成未成功，退出码 $code 。请阅读上方提示后处理。" -ForegroundColor Red
    exit (Complete-Entry -ExitCode $code)
}
exit (Complete-Entry -ExitCode $code -SuccessMessage "原文文档已生成到 docs\generated\。可打开查看真实数值。")
