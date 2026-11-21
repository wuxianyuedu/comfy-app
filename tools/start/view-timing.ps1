#Requires -Version 5.1
<#
view-timing.ps1 — 看钩子 / 复算耗时账的人读版（Windows 双击入口，ISSUE #4766）

作用：把两份耗时账本（JSONL，机器逐次追加写、人直接读很难）渲染成汇总表：
  · precommit —— 提交门槛（pre-commit D0）的逐次总耗时与逐步中位数；
  · premerge  —— push 前合并前复算的逐次总墙钟与逐格中位数。

实际逻辑在 scripts\gates\precommit-timing.mjs 与 scripts\gates\premerge-timing.mjs
（跨平台唯一实现，登记在 docs\standards\launch-and-build.md §9.5），本入口只负责
「定位项目根 → 转交 node → 透传退出码」。

用法：
  双击 <项目根>\tools\start\view-timing.ps1
  或在终端执行：pwsh -NoProfile -ExecutionPolicy Bypass -File .\tools\start\view-timing.ps1
                 [-Target both|precommit|premerge] [额外参数]

  额外参数原样透传给底层脚本（与 node scripts\gates\<名>.mjs 的旗标相同）：
    --last 5     只看最近 5 次
    --json       出机器可读 JSON
  跨平台等价：pnpm timing:view（两份账按顺序各出一张表）。
#>
[CmdletBinding()]
param(
    [ValidateSet("both", "precommit", "premerge")]
    [string]$Target = "both",
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$ScriptArgs
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

. (Join-Path $PSScriptRoot "..\..\scripts\entry-common.ps1")
$root = Get-ProjectRoot -StartDir $PSScriptRoot
Set-Location $root

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    Write-Host "[ERROR] 未找到 node：耗时账查看器需要 Node.js。" -ForegroundColor Red
    exit 1
}

$targets = @()
if ($Target -ne "premerge") {
    $targets += @{ Name = "precommit"; Script = "scripts\gates\precommit-timing.mjs" }
}
if ($Target -ne "precommit") {
    $targets += @{ Name = "premerge"; Script = "scripts\gates\premerge-timing.mjs" }
}

$exitCode = 0
foreach ($t in $targets) {
    $script = Join-Path $root $t.Script
    if (-not (Test-Path -LiteralPath $script)) {
        Write-Host "[ERROR] 未找到 $($t.Script)（耗时账的跨平台实现）。" -ForegroundColor Red
        $exitCode = 1
        continue
    }
    # 命令行回显：与 .mjs 侧同一 `>>> ` 前缀，让「这次到底跑了什么」有据可查。
    Write-Host ">>> node `"$script`" $($ScriptArgs -join ' ')" -ForegroundColor Yellow
    & $node.Source $script @ScriptArgs
    if ($LASTEXITCODE -ne 0) { $exitCode = $LASTEXITCODE }
}

exit (Complete-Entry -ExitCode $exitCode)
