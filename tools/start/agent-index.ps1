#Requires -Version 5.1
<#
agent-index.ps1 — 建立 / 体检本地代码索引（codegraph / zvec-grep），供 MCP 语义检索用（ISSUE #4585）

用法：
  双击 <项目根>\tools\start\agent-index.ps1（无参默认即建缺失的索引，等价 --init）
  或在终端执行：pwsh -NoProfile -ExecutionPolicy Bypass -File .\tools\start\agent-index.ps1 [--init]

说明：
  1. 逻辑在 scripts/platform/agent-index.mjs（跨平台唯一实现）；本入口只负责定位项目根、
     调用 node、透传参数与退出码。跨平台等价：pnpm agent:index [--init]。
  2. 双击场景没有传参入口，故无参时默认补 --init（就地建缺失索引后重报状态）；
     只读体检（不写索引）请用 pnpm agent:index。
  3. 索引目录 .codegraph\ 与 .zvec-grep\ 是本机缓存（已 gitignore），删除对源码零影响。
  4. codegraph / zvec-grep 是每台开发机各自的全局工具，不在 package.json 里；
     命令不在 PATH 时先装：pnpm add -g @colbymchenry/codegraph 或 pnpm add -g @zvec/zvec-grep。
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

# 双击无参 = 建索引（--init）；终端显式给参则原样透传（.mjs 目前只认 --init）
$effectiveArgs = if ($null -ne $ScriptArgs -and $ScriptArgs.Count -gt 0) { $ScriptArgs } else { @("--init") }

Write-Host "[INFO] 正在检查 / 初始化代码索引（codegraph / zvec-grep）..." -ForegroundColor Cyan
Write-Host ""

$nodeArgs = @("scripts/platform/agent-index.mjs") + $effectiveArgs
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
    Write-Host "[ERROR] 代码索引未就绪（初始化未完成或工具缺席），退出码 $code 。" -ForegroundColor Red
    Write-Host "[HINT] 命令不在 PATH 时先装全局工具：pnpm add -g @colbymchenry/codegraph / pnpm add -g @zvec/zvec-grep" -ForegroundColor Yellow
    Write-Host "[HINT] zvec-grep 若提示缺 embedding provider，那是人选形态：用 zg config / zg auth status 自查后重跑。" -ForegroundColor Yellow
    Write-Host "[HINT] 索引没就绪时语义检索会返回空：『查不到』不等于『仓库里没有』，结论仍需 Grep / Read 复核。" -ForegroundColor Yellow
}

exit (Complete-Entry -ExitCode $code -SuccessMessage "代码索引已就绪（codegraph / zvec-grep），语义检索通道可用。")
