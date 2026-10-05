#Requires -Version 5.1
<#
run-tests.ps1 - Comfy-APP-T3 单跑 Vitest（补 verify-quality 之外的「只想跑测试」路径）
===============================================================================
后台是 `pnpm exec vitest run`（规范 11.7 / 13.5 的测试门禁用同一条命令），本脚本
只负责三件门禁脚本不该管的事：工作目录、已知基线失败的排除、参数透传。

被 tools\start\run-tests.ps1 入口调用；任一步失败以非零退出码结束，并在 stdout
给出中文的失败原因与下一步指引。

Usage:
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\run-tests.ps1
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\run-tests.ps1 -Full
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\run-tests.ps1 src\lib\media.test.ts
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\run-tests.ps1 -Full - -t "isVideo"
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\run-tests.ps1 -- --reporter=verbose

位置参数与 `--` 之后的参数都会原样透传给 vitest。

为何要有它（而不是复用 verify-quality.ps1）:
  verify-quality.ps1 是「一键门禁」，三项 typecheck / eslint / vitest 固定串联，
  且 -Mode test 会强制排除已知基线失败文件。日常改一处代码想只跑一个测试文件、
  想复现那两个历史失败文件、或想用 vitest 自己的参数（-t / -u / --reporter）
  时，它都不合适——本脚本补这一条路径。

-Full 的语义（与 quality-gate.ps1 / quality-gate.mjs 共用同一份 KNOWN_FAILED_CASES 登记表）:
  默认排除已知基线失败**用例**（粒度是用例，见规范 11.12），保证单跑时的红/绿能
  直接归因到本次改动；-Full 反其道而行，保留它们，用来复现基线失败。
  登记表与参数拼法的唯一来源在 scripts\quality-gate-shared.mjs（Node 侧
  scripts/quality-gate.mjs 也读它），本脚本**调 scripts/known-failed-args.mjs** 拿
  拼好的参数而不是自己解析源码——从 `.mjs` 源码里抠字符串字面量等于把另一门语言
  的文件当数据源，改一次写法就会静默抠出空数组（ISSUE #1282 的同族现场）。
#>
[CmdletBinding()]
param(
  [switch]$Full,
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$Remaining
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Say-OK   { Write-Host "[OK]   " -NoNewline -ForegroundColor Green;  Write-Host "$args" }
function Say-Info { Write-Host "[INFO] " -NoNewline -ForegroundColor Cyan;   Write-Host "$args" }
function Say-Err  { Write-Host "[ERROR]" -NoNewline -ForegroundColor Red;    Write-Host "$args" }

# ── 0) 工具链与依赖 ─────────────────────────────────────────
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Say-Err "未检测到 Node.js，请先安装：https://nodejs.org/（LTS 即可）。"
    exit 1
}
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    Say-Err "未检测到 pnpm，请先执行：corepack enable"
    exit 1
}
# vitest 与 pnpm exec 都从 node_modules 里解析；没装依赖时 pnpm 会去联网解析
# （本项目 pnpm-workspace.yaml 已关掉 verifyDepsBeforeRun，不会自动补装），
# 报错会是一串看不懂的解析失败，这里先给出人能照做的提示。
if (-not (Test-Path -LiteralPath (Join-Path $root "node_modules\.bin"))) {
    Say-Err "未检测到 node_modules\.bin，说明依赖还没装。"
    Say-Info "请先在项目根目录执行：pnpm install"
    Say-Info "（或双击 tools\start\run-local.ps1 让它自动补装依赖。）"
    exit 1
}

# ── 1) 透传参数：`--` 之后的与位置参数一视同仁 ───────────────
$passthrough = @()
if ($Remaining) { $passthrough = @($Remaining | Where-Object { $_ -ne "--" }) }

# ── 2) 已知基线失败登记表：调 scripts/known-failed-args.mjs，不自己解析源码 ──
# 登记表与「参数怎么拼」的唯一来源是 scripts/quality-gate-shared.mjs（Node 侧
# scripts/quality-gate.mjs 也 import 它）。本文件**调那个 Node 出口**拿拼好的
# 参数，而不是拿正则去 `.mjs` 源码文本里抠字符串字面量——后者等于把另一门语言的
# 文件当数据源，改一次写法就静默抠出空数组（ISSUE #1282 的同族现场）。
# 拿不到时显式报错并降级为「不排除」，不让「读不到」看起来像「本来就没有基线失败」。
function Get-KnownFailedDescribe {
  $helper = Join-Path $root "scripts\known-failed-args.mjs"
  if (-not (Test-Path -LiteralPath $helper)) {
    Say-Err "未找到 scripts\known-failed-args.mjs（已知基线失败登记表的出口）；本次不排除任何用例。"
    return @()
  }
  $out = @(& node $helper --describe 2>&1)
  if ($LASTEXITCODE -ne 0) {
    Say-Err "读已知基线失败登记表失败（exit $LASTEXITCODE）；本次不排除任何用例。"
    return @()
  }
  return @($out | Where-Object { $_ -ne "" })
}

function Get-KnownFailedArgs {
  $helper = Join-Path $root "scripts\known-failed-args.mjs"
  if (-not (Test-Path -LiteralPath $helper)) { return @() }
  # **每行一个参数**：模式里含空格（用例全名按 `" > "` 连接），`@(& node ...)` 按行
  # 收进数组正好保住它，别再 join/split 一次。
  $out = @(& node $helper)
  if ($LASTEXITCODE -ne 0) {
    Say-Err "拼已知基线失败排除参数失败（exit $LASTEXITCODE）；本次不排除任何用例。"
    return @()
  }
  return @($out | Where-Object { $_ -ne "" })
}

# ── 3) 组装 vitest 参数 ─────────────────────────────────────
$vitestArgs = @("exec", "vitest", "run")

if ($passthrough.Count -gt 0) {
    # 用户显式指定了测试文件/参数：此时不再追加排除项——传了具体用例还去排除它
    # 只会让「我明明指定了它却不跑」更难理解，判定权交回给调用方。
    Say-Info "透传参数：$($passthrough -join ' ')（指定了文件的这一次不再追加已知基线失败排除项）"
    $vitestArgs += $passthrough
} else {
    $describe = @(Get-KnownFailedDescribe)
    if ($Full) {
        if ($describe.Count -gt 0) {
            Say-Info "全量模式：已知基线失败用例一并运行（$($describe -join ' / ')），用于复现基线失败。"
        }
    } elseif ($describe.Count -gt 0) {
        Say-Info "排除已知基线失败用例（与本改动无关的历史失败，粒度是用例）：$($describe -join ' / ')"
        Say-Info "想连它们一起跑，用 -Full（或双击 tools\start\run-tests.ps1 时加 -Full）。"
        $vitestArgs += Get-KnownFailedArgs
    }
}

# ── 4) 执行 ────────────────────────────────────────────────
$printable = ($vitestArgs | ForEach-Object { "`"$_`"" }) -join " "
Write-Host ""
Say-Info ">>> pnpm $printable"
Write-Host ""
& pnpm @vitestArgs
$code = $LASTEXITCODE

Write-Host ""
if ($code -eq 0) {
    Say-OK "vitest 全部通过。"
} else {
    Say-Err "vitest 存在未通过的用例（exit $code）。"
    Say-Info "只看失败用例：重跑时加 -- --reporter=verbose；只跑某个文件把文件路径传进来即可。"
}
exit $code
