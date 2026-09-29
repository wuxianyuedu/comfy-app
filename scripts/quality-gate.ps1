#Requires -Version 5.1
<#
quality-gate.ps1 - Comfy-APP-T3 local quality gate (one-click, for non-devs)
===============================================================================
Runs the PR/CI hard quality gates as a repeatable one-click script, so non-devs
don't have to memorize a long chain of pnpm commands. Invoked by the root
tools/start/verify-quality.ps1. Any failing gate exits non-zero and is printed in red.

Usage:
  powershell -File scripts\quality-gate.ps1                all three gates
  powershell -File scripts\quality-gate.ps1 -Mode typecheck
  powershell -File scripts\quality-gate.ps1 -Mode lint
  powershell -File scripts\quality-gate.ps1 -Mode test
  powershell -File scripts\quality-gate.ps1 -Mode all

Mode: typecheck | lint | test | all   (default all)

Extend / maintain - how to add a new gate:
  Each gate is one entry in the $Blocks list below:
      @{ Name="id"; Label="human text"; Cmd="pnpm"; Args=@("exec","...","..."); Run=$true }
  - Run=$true  -> included in the default 'all' run. Set $false for manual-only.
  - On Windows the script automatically maps pnpm/npm/node to the .cmd shim.
  - New test files under the vitest include pattern are picked up automatically.
  - Known baseline failures live in KNOWN_FAILED_FILES; once fixed, delete the
    entry and it is enforced again.
#>
param(
  [ValidateSet("typecheck", "lint", "format", "test", "all")]
  [string]$Mode = "all"
)

$ErrorActionPreference = "Continue"

# Known baseline failures (pre-existing on master, unrelated to this change).
# Full vitest excludes them by default so one-click gives a trustworthy green.
# Remove an entry once it is fixed so it is enforced again.
#
# **清单的唯一来源是 scripts/quality-gate-shared.mjs**（Node 侧同一门禁
# scripts/quality-gate.mjs 也要读它）。此前它写在本文件里、由
# scripts/run-tests.ps1 用正则解析——那等于把另一门语言的源码当数据源，
# 改一次写法就会让解析静默返回空数组（排除项悄悄失效，红/绿不再可归因）。
# 解析失败时**降级为不排除**并显式 WARN，不再假装清单为空是正常情况。
function Get-KnownFailedFilesFromShared {
  $shared = Join-Path $PSScriptRoot "quality-gate-shared.mjs"
  if (-not (Test-Path -LiteralPath $shared)) {
    Write-Host "  [WARN] 未找到 $shared，已知基线失败清单按「空」处理（不排除任何文件）。" -ForegroundColor Yellow
    return @()
  }
  $text = Get-Content -LiteralPath $shared -Raw -Encoding UTF8
  $m = [regex]::Match($text, '(?s)KNOWN_FAILED_FILES\s*=\s*\[(.*?)\]')
  if (-not $m.Success) {
    Write-Host "  [WARN] 无法从 $shared 解析 KNOWN_FAILED_FILES，按「空」处理。" -ForegroundColor Yellow
    return @()
  }
  # 单双引号都要认：Node 侧同一个模块里两种写法都合法。
  return @([regex]::Matches($m.Groups[1].Value, "['\"]([^'\"]+)['\"]") | ForEach-Object { $_.Groups[1].Value })
}

$KNOWN_FAILED_FILES = @(Get-KnownFailedFilesFromShared)

# ---- vitest 参数拼装（与 tools\start\run-tests.ps1 共用）----
# 已知基线失败要作为 `vitest run --exclude <file>` 传给 vitest 原生命令；拼装收敛在此，
# 供本脚本的 test 门禁与 run-tests.ps1 的 -Full 分支共用，避免两处各写一份漂移。
function Get-VitestKnownFailureArgs {
  $excludeArgs = @()
  foreach ($f in $KNOWN_FAILED_FILES) { $excludeArgs += @("--exclude", $f) }
  return $excludeArgs
}

# ---- Gate list: append a new gate here ----
$Blocks = @(
  @{ Name = "typecheck"; Label = "Typecheck (tsc --noEmit)"; Cmd = "pnpm";
     Args = @("typecheck"); Run = $true }
  # eslint 的扫描范围（白名单目录）与参数收在 package.json 的 `lint` 脚本里：
  # 本门禁、.githooks/pre-commit 第 7 步、quality-gate.mjs、CI 共用同一份命令，
  # 各自的目录清单与 `--cache` 参数不再各抄一遍（抄一遍就会漂移；范围口径与
  # `--cache-strategy content` 的理由见 eslint.config.js 顶部那节）。
  @{ Name = "lint";      Label = "ESLint zero error / zero warning";
     Cmd = "pnpm"; Args = @("run","lint"); Run = $true }
  @{ Name = "format";    Label = "Prettier format ratchet (scripts/check-format.cjs)";
     Cmd = "node"; Args = @("scripts\check-format.cjs"); Run = $true }
  # 覆盖率门槛此前是**死配置**：`vitest.config.ts` 的 `coverage.thresholds` 写了
  # 几十条按实测定的门槛，而这一步是裸 `vitest run`，不带 `--coverage` —— 没有任何
  # 自动化路径判定过它们（规范 §11.7 / 台账 E2）。与 quality-gate.mjs 同批同步。
  # 两个约束：① 只在全量档判 —— 单文件跑 --coverage 会把其余路径按 0% 算、
  # thresholds 每条都刷红；② 红与覆盖率已各自记账（vitest.config.ts 的
  # reportOnFailure），不再「一条红 → 报告不产出 → 门槛静默缺席」。
  @{ Name = "test";      Label = "Vitest full run + coverage ratchet (excluding known baseline failures)";
     Cmd = "pnpm"; Args = @("exec","vitest","run","--coverage"); Run = $true; IsTest = $true }
)

# Which gates to run
$toRun = @()
if ($Mode -eq "all") {
  $toRun = @($Blocks | Where-Object { $_.Run })
} else {
  $target = @($Blocks | Where-Object { $_.Name -eq $Mode })
  if ($target.Count -eq 0) { Write-Host "Unknown gate: $Mode" -ForegroundColor Red; exit 2 }
  $toRun = $target
}

# ---- helpers ----
function Invoke-Check {
  param([hashtable]$Block)

  Write-Host ""
  Write-Host "==> $($Block.Label)" -ForegroundColor Cyan

  # On Windows append .cmd so PowerShell can locate the shim.
  $exe = $Block.Cmd
  if ($env:OS -and $env:OS -like "Windows*") {
    if ($Block.Cmd -match "^(pnpm|npm|node)$") { $exe = "$($Block.Cmd).cmd" }
  }

  $argsAll = @($Block.Args)
  if ($Block.IsTest) {
    foreach ($f in $KNOWN_FAILED_FILES) {
      Write-Host "  skip known failure: $f" -ForegroundColor DarkGray
    }
    # 排除项由 Get-VitestKnownFailureArgs 统一拼装：同一份实现也被
    # tools\start\run-tests.ps1（只跑测试、不跑整套门禁）的 -Full 分支复用，
    # 避免出现「门禁排除了、单跑没排除」的两套口径。
    $argsAll += @(Get-VitestKnownFailureArgs)
  }

  $printable = ($argsAll | ForEach-Object { "`"$_`"" }) -join " "
  Write-Host ">>> $exe $printable" -ForegroundColor Yellow

  & $exe @argsAll
  $code = $LASTEXITCODE
  if ($code -eq 0) { Write-Host "  [OK] $($Block.Label) passed" -ForegroundColor Green }
  else             { Write-Host "  [FAIL] $($Block.Label) failed (exit $code)" -ForegroundColor Red }
  return $code
}

# ---- dependency-drift preflight ----
# 拉取更新若新增/删改了依赖而未重跑 `pnpm install`，node_modules 会与 lockfile 脱节：
# 老代码里 import 的包（如 msw）在新 node_modules 里不存在，typecheck / eslint / vitest
# 会各自抛出一串晦涩的 "Failed to resolve import xxx"，让人误以为是自己改坏了。
# pnpm 会把「最近一次成功安装时的 lockfile」复制到 node_modules\.pnpm\lock.yaml；
# 与仓库根 pnpm-lock.yaml 内容不一致即判定依赖陈旧，先提示重装再跑门禁（不自动装，
# 避免 dev server 运行中安装触发原生模块 EPERM 连锁失败，见 launch-and-build.md §5）。
function Test-DepDrift {
  $root = Split-Path -Parent $PSScriptRoot      # scripts\quality-gate.ps1 → 项目根
  $nm   = Join-Path $root "node_modules"
  if (-not (Test-Path -LiteralPath $nm)) { return $true }          # 完全没装过
  $rootLock = Join-Path $root "pnpm-lock.yaml"
  $instLock = Join-Path $nm ".pnpm\lock.yaml"
  if (-not (Test-Path -LiteralPath $instLock)) { return $true }    # install 中断/残缺
  if (-not (Test-Path -LiteralPath $rootLock)) { return $false }   # 无根 lockfile，跳过
  $h1 = (Get-FileHash -LiteralPath $rootLock -Algorithm SHA256).Hash
  $h2 = (Get-FileHash -LiteralPath $instLock  -Algorithm SHA256).Hash
  return ($h1 -ne $h2)
}

# 差异明细：只报「不一致」等于把定位成本全推给人（ISSUE #550），
# 逐项列出哪些依赖/条目变了。解析与对比都在 Node 侧 scripts/lockfile/lock-diff.mjs，
# 与 tools\start\run-local.ps1 复用同一份实现（避免两处各写一套后口径漂移）。
function Write-DepDriftDetail {
  $root = Split-Path -Parent $PSScriptRoot
  $instLock = Join-Path $root "node_modules\.pnpm\lock.yaml"
  if (-not (Test-Path -LiteralPath $instLock)) {
    Write-Host "  [INFO] 没有可比对的历史 lockfile（首次安装或 install 被中断），跳过差异明细。" -ForegroundColor Cyan
    return
  }
  Write-Host "  差异明细（仓库 pnpm-lock.yaml 对比最近一次安装时的 lockfile）：" -ForegroundColor Cyan
  Push-Location $root
  try {
    & node "scripts\lockfile\diff-cli.mjs" --installed $instLock --root $root
  } finally {
    Pop-Location
  }
  Write-Host ""
}

if (Test-DepDrift) {
  Write-Host ""
  Write-Host "==> 依赖一致性预检" -ForegroundColor Cyan
  Write-Host "  [FAIL] 依赖与 pnpm-lock.yaml 不一致（拉取更新后未重装，或上次 install 被中断）。" -ForegroundColor Red
  Write-DepDriftDetail
  Write-Host "        请先关闭所有正在运行的本项目窗口（dev server 会锁住原生模块），" -ForegroundColor Yellow
  Write-Host "        然后在项目根目录执行：pnpm install" -ForegroundColor Yellow
  Write-Host "        或重新双击 tools\start\run-local.ps1 让它自动补装依赖（Linux / macOS 执行 pnpm install）。" -ForegroundColor Yellow
  Write-Host "        详见 docs\guides\sync-after-pull.md" -ForegroundColor Yellow
  Write-Host ""
  exit 1
}

# ---- run ----
$exitCode = 0
foreach ($b in $toRun) {
  $code = Invoke-Check -Block $b
  if ($code -ne 0) { $exitCode = $code }
}

Write-Host ""
if ($exitCode -eq 0) {
  Write-Host "All quality gates passed OK" -ForegroundColor Green
} else {
  Write-Host "Quality gates have failures; please fix and re-run." -ForegroundColor Red
}
exit $exitCode
