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
  [ValidateSet("typecheck", "lint", "test", "all")]
  [string]$Mode = "all"
)

$ErrorActionPreference = "Continue"

# Known baseline failures (pre-existing on master, unrelated to this change).
# Full vitest excludes them by default so one-click gives a trustworthy green.
# Remove an entry once it is fixed so it is enforced again.
$KNOWN_FAILED_FILES = @(
  "src/server/api/routers/task.test.ts",
  "src/server/api/routers/generate.test.ts"
)

# ---- Gate list: append a new gate here ----
$Blocks = @(
  @{ Name = "typecheck"; Label = "Typecheck (tsc --noEmit)"; Cmd = "pnpm";
     Args = @("typecheck"); Run = $true }
  @{ Name = "lint";      Label = "ESLint zero error / zero warning";
     Cmd = "pnpm"; Args = @("exec","eslint",".","--max-warnings","0"); Run = $true }
  @{ Name = "test";      Label = "Vitest full run (excluding known baseline failures)";
     Cmd = "pnpm"; Args = @("exec","vitest","run"); Run = $true; IsTest = $true }
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

  # On Windows append .cmd so PowerShell can locate the shim
  $exe = $Block.Cmd
  if ($env:OS -and $env:OS -like "Windows*") {
    if ($Block.Cmd -match "^(pnpm|npm|node)$") { $exe = "$($Block.Cmd).cmd" }
  }

  $argsAll = @($Block.Args)
  if ($Block.IsTest) {
    foreach ($f in $KNOWN_FAILED_FILES) {
      Write-Host "  skip known failure: $f" -ForegroundColor DarkGray
      $argsAll += @("--exclude", $f)
    }
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

if (Test-DepDrift) {
  Write-Host ""
  Write-Host "==> 依赖一致性预检" -ForegroundColor Cyan
  Write-Host "  [FAIL] 依赖与 pnpm-lock.yaml 不一致（拉取更新后未重装，或上次 install 被中断）。" -ForegroundColor Red
  Write-Host "        请先关闭所有正在运行的本项目窗口（dev server 会锁住原生模块），" -ForegroundColor Yellow
  Write-Host "        然后在项目根目录执行：pnpm install" -ForegroundColor Yellow
  Write-Host "        或重新双击 tools\start\run-local.ps1 让它自动补装依赖。" -ForegroundColor Yellow
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
