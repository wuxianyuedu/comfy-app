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

-Full 的语义（与 quality-gate.ps1 / quality-gate.mjs 共用同一份 KNOWN_FAILED_FILES 清单）:
  默认排除已知基线失败文件（task / generate 两个 router 测试），保证单跑时的
  红/绿能直接归因到本次改动；-Full 反其道而行，保留这些文件，用来复现基线失败。
  清单的唯一来源在 scripts\quality-gate-shared.mjs（Node 侧 scripts/quality-gate.mjs
  也读它），本脚本解析它而不是抄一份，避免「修好了却只在一处解禁」的漂移。
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

# ── 2) 已知基线失败清单：读 scripts/quality-gate-shared.mjs，不另抄一份 ──
# 清单的唯一来源是那个纯数据模块（Node 侧 scripts/quality-gate.mjs 也 import 它）。
# 此前清单写在本仓库的 quality-gate.ps1 里、由本文件用正则解析 .ps1 源码——那等于
# 把另一门语言的文件当数据源，改一次写法就会静默返回空数组。解析失败时显式
# WARN 并降级为「不排除」，不再让「清单读不到」看起来像「本来就没有基线失败」。
function Get-KnownFailedFiles {
  $shared = Join-Path $root "scripts\quality-gate-shared.mjs"
  if (-not (Test-Path -LiteralPath $shared)) {
    Say-Err "未找到 scripts\quality-gate-shared.mjs（已知基线失败清单的唯一来源）；本次不排除任何文件。"
    return @()
  }
  $text = Get-Content -LiteralPath $shared -Raw -Encoding UTF8
  $m = [regex]::Match($text, '(?s)KNOWN_FAILED_FILES\s*=\s*\[(.*?)\]')
  if (-not $m.Success) {
    Say-Err "无法从 scripts\quality-gate-shared.mjs 解析 KNOWN_FAILED_FILES；本次不排除任何文件。"
    return @()
  }
  return @([regex]::Matches($m.Groups[1].Value, "['""]([^'""]+)['""]") | ForEach-Object { $_.Groups[1].Value })
}

# ── 3) 组装 vitest 参数 ─────────────────────────────────────
$vitestArgs = @("exec", "vitest", "run")

if ($passthrough.Count -gt 0) {
    # 用户显式指定了测试文件/参数：此时不再追加排除项——传了具体文件还去 --exclude
    # 只会让「我明明指定了它却不跑」更难理解，判定权交回给调用方。
    Say-Info "透传参数：$($passthrough -join ' ')（指定了文件的这一次不再追加已知基线失败排除项）"
    $vitestArgs += $passthrough
} else {
    $known = @(Get-KnownFailedFiles)
    if ($Full) {
        if ($known.Count -gt 0) {
            Say-Info "全量模式：已知基线失败文件一并运行（$($known -join ' / ')），用于复现基线失败。"
        }
    } elseif ($known.Count -gt 0) {
        Say-Info "排除已知基线失败文件（与本改动无关的历史失败）：$($known -join ' / ')"
        Say-Info "想连它们一起跑，用 -Full（或双击 tools\start\run-tests.ps1 时加 -Full）。"
        foreach ($f in $known) { $vitestArgs += @("--exclude", $f) }
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
