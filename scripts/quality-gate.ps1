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
  [ValidateSet("typecheck", "lint", "format", "test", "dependencyAudit", "all")]
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
  # 这条**必须用单引号字符串**写：PowerShell 里 `\` 不是转义符，双引号串内的 `\"`
  # 会当场把字符串结束掉，整份脚本从这一行起解析失败（实测 PS 5.1 与 pwsh 7 各报
  # 3 个 ParserError，`-Mode` 无论给什么都进不了脚本体 —— 也就是说这份一键门禁
  # 在此形态下是**整份死掉**的，而没有任何自动化执行者会去解析 .ps1，所以红不出来）。
  # 单引号串里 `"` 是字面量，`''` 才是一个 `'`。
  return @([regex]::Matches($m.Groups[1].Value, '[''"]([^''"]+)[''"]') | ForEach-Object { $_.Groups[1].Value })
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
  # 依赖漏洞扫描棘轮（ISSUE #1331，规范 §13.5）：与 quality-gate.mjs 的 GATES 同批同步。
  # 刻意不在 pre-commit —— 它是网络请求，离线/registry 抖动不该变成提交失败（§13.5.4
  # 「按需召唤」那一层）；拿不到 registry 时脚本打「未扫描」退 0，话术里不许出现「干净」。
  # 台账按 (包名, advisory id) 记账、双向拦、--update 只许降，理由见脚本头。
  @{ Name = "dependencyAudit"; Label = "Dependency audit ratchet (high/critical; ledger keyed by package+advisory)";
     Cmd = "node"; Args = @("scripts\check-dependency-audit.mjs"); Run = $true }
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
#
# **判决必须走 Node 侧那份语义比较器，不能自己比哈希**（ISSUE #1338）。理由与
# `scripts/prepare-local-run.ps1` 第 5 步写的是同一条，那边早就修对了、这边漏了：
# pnpm 复制到 `node_modules\.pnpm\lock.yaml` 的那一份与仓库根 `pnpm-lock.yaml` **本就不同形**
# （实测本机 12910 行 vs 13068 行；顶层键顺序不同、根文件里还含 `---` 分隔的第二段，
# 而且两者由同一次 install 写下、mtime 只差 1 秒）⇒ 逐字节哈希比对**恒为「不一致」**，
# 于是这份一键门禁此前不论依赖新不新鲜都停在预检、一条门禁都跑不到。
# 更糟的是它下面打印的差异明细走的就是那份语义比较器，结论恰好是「实质一致」——
# **同一段里两个结论互相矛盾**，而没有任何执行者会发现（没人跑 `.ps1` 到这一步）。
#
# 全仓唯一实现在 `scripts/lockfile/diff-cli.mjs`（与启动器 `launcher-core/worktree.mjs`
# 同源），退出码：0 一致 / 1 有实质差异 / 2 参数或读取错误。这里只读它的退出码并把它
# 的输出转手打印，**不再第二次调用、也不再自己实现一遍解析**。
function Get-DepDrift {
  # 返回 @{ state = "clean" | "drift" | "judge-broken"; report = <string[]> }
  $root = Split-Path -Parent $PSScriptRoot      # scripts\quality-gate.ps1 → 项目根
  $nm   = Join-Path $root "node_modules"
  if (-not (Test-Path -LiteralPath $nm)) {
    return @{ state = "drift"; hasInstLock = $false; report = @("node_modules 完全没装过") }
  }
  $rootLock = Join-Path $root "pnpm-lock.yaml"
  $instLock = Join-Path $nm ".pnpm\lock.yaml"
  if (-not (Test-Path -LiteralPath $instLock)) {
    # install 中断或残缺：没有可比对的历史 lockfile，明细这一步没有意义。
    return @{ state = "drift"; hasInstLock = $false; report = @() }
  }
  if (-not (Test-Path -LiteralPath $rootLock)) {
    return @{ state = "clean"; hasInstLock = $true; report = @() }  # 无根 lockfile，跳过
  }
  # 先确认那份唯一实现**及其两个被 import 的实现文件**都在：缺任何一个，node 都会在
  # 加载阶段就退出 1，而 1 在这份契约里是「判出了实质差异」—— 那就会把「判据没了」
  # 报成「依赖陈旧、去重装」（ISSUE #1338 实测到的正是这条误导；diff-cli 内部意外
  # 已收成 2，但「模块加载失败」发生在那个 try 之前，只能在这里拦）。
  $diffCliFiles = @(
    (Join-Path $root "scripts\lockfile\diff-cli.mjs"),
    (Join-Path $root "scripts\lockfile\lock-diff.mjs"),
    (Join-Path $root "scripts\lockfile\render-lock-diff.mjs")
  )
  $missing = @($diffCliFiles | Where-Object { -not (Test-Path -LiteralPath $_) })
  if ($missing.Count -gt 0) {
    return @{ state = "judge-broken"; hasInstLock = $true; report = $missing }
  }
  Push-Location $root
  try {
    $report = & node (Join-Path $root "scripts\lockfile\diff-cli.mjs") --installed $instLock --root $root 2>&1
    $code = $LASTEXITCODE
  } catch {
    # `node` 不在 PATH 上（或起不来）：这是**判据跑不了**，不是「依赖陈旧」。
    Pop-Location
    return @{ state = "judge-broken"; hasInstLock = $true; report = @("$($_.Exception.Message)") }
  }
  Pop-Location
  if ($code -eq 0) { return @{ state = "clean"; hasInstLock = $true; report = @($report) } }
  # 退出码 2 是「判不了」（缺文件 / 参数错）：与 1 一样不许静默放行，但要分开说 ——
  # 让人去重装解决不了「判据自己坏了」。
  $state = if ($code -eq 1) { "drift" } else { "judge-broken" }
  return @{ state = $state; hasInstLock = $true; report = @($report); code = $code }
}

$Drift = Get-DepDrift
if ($Drift.state -ne "clean") {
  Write-Host ""
  Write-Host "==> 依赖一致性预检" -ForegroundColor Cyan
  if ($Drift.state -eq "judge-broken") {
    # 行首带 ASCII 标签 `[DEP-JUDGE]`：Windows 控制台代码页会把中文输出转成乱码
    # （`powershell.exe` 5.1 尤甚），而这条判决的正反两向都要能被用例稳定断言。
    Write-Host "  [FAIL][DEP-JUDGE] 无法判定依赖是否与 lockfile 一致 —— 判据自己跑不起来，不是「依赖陈旧」。" -ForegroundColor Red
    Write-Host "  明细（Node 侧 scripts\lockfile\diff-cli.mjs）：" -ForegroundColor Cyan
    $Drift.report | ForEach-Object { Write-Host "    $_" }
    Write-Host "        先确认 `node` 在 PATH 上、且仓库根有 scripts\lockfile\diff-cli.mjs；" -ForegroundColor Yellow
    Write-Host "        这条判据与 prepare-local-run.ps1 / quality-gate.mjs 共用同一份实现，" -ForegroundColor Yellow
    Write-Host "        跑不了通常意味着这份检出本身残缺（换一台干净检出对比一次就能定性）。" -ForegroundColor Yellow
    Write-Host ""
    exit 1
  }
  Write-Host "  [FAIL][DEP-DRIFT] 依赖与 pnpm-lock.yaml 不一致（拉取更新后未重装，或上次 install 被中断）。" -ForegroundColor Red
  # 差异明细只报「不一致」等于把定位成本全推给人（ISSUE #550）：逐项列出变了什么。
  # 判定阶段那次调用的输出直接转手，不再调第二次（两次调用之间 lockfile 可能已变，
  # 那会长出「判决说漂了、明细说没漂」这种自相矛盾 —— 就是本条要修的原形状）。
  if ($Drift.hasInstLock) {
    Write-Host "  差异明细（仓库 pnpm-lock.yaml 对比最近一次安装时的 lockfile）：" -ForegroundColor Cyan
    $Drift.report | ForEach-Object { Write-Host "  $_" }
  } else {
    Write-Host "  [INFO] 没有可比对的历史 lockfile（首次安装或 install 被中断），跳过差异明细。" -ForegroundColor Cyan
  }
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
