#Requires -Version 5.1
<#
sync-lint.ps1 - Comfy-APP-T3 开发日常检查：先同步依赖，再跑 ESLint
===============================================================================
给「拉取更新 / 改完代码后不确定要敲哪个命令」的场景：双击或单命令即自动
pnpm install（对齐 pnpm-lock.yaml）+ pnpm lint，其余（typecheck / test）留给
更完整的 tools\start\verify-quality.ps1。

被 tools\start\sync-lint.ps1 入口调用。任一步失败均以非零退出码结束，
并在 stdout 用红色给出失败步骤与下一步指引。

Usage:
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\sync-lint.ps1
  或双击 tools\start\sync-lint.ps1

设计要点（为何先 install）:
  - 拉取更新后若远端改了 pnpm 相关配置/依赖，node_modules 会与 lockfile 脱节，
    eslint 会抛 "Failed to resolve import xxx" 这类误导读到「以为改坏了代码」。
  - 因此这里先执行一次非交互 pnpm install（CI=true）让依赖对齐，再跑 lint。
  - 注意：本检出的应用服务（dev server）在跑时，`node_modules` 里的原生模块
    better-sqlite3 等会被进程锁定，此时 `pnpm install` 会以 EPERM 失败并拖垮后续
    每一条 pnpm 命令（AGENTS 硬规则 9）。所以这里**先问一句再装**：判据不在本文件，
    转交 `node scripts\deps-install-guard.mjs`（与编排器补装路径同一份实现，
    按「占端口的进程是不是本检出的应用服务」判归属，隔壁检出占端口不会误拦）。
    判到在跑就**不再往下装**，给出「先关窗口再重新双击」的出口；
    这里不再在本文件里探端口：平台侧的探测只收在 `launcher-core` 那一处，
    而裸探端口本来也判不出归属（规范 §9 / §9.5）。
#>
param()

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$env:CI = "true"

function Say-OK   { Write-Host "[OK]   " -NoNewline -ForegroundColor Green; Write-Host "$args" }
function Say-Info { Write-Host "[INFO] " -NoNewline -ForegroundColor Cyan;  Write-Host "$args" }
function Say-Warn { Write-Host "[WARN] " -NoNewline -ForegroundColor Yellow; Write-Host "$args" }
function Say-Err  { Write-Host "[ERROR]" -NoNewline -ForegroundColor Red;    Write-Host "$args" }

# ── 0) 工具链存在性 ─────────────────────────────────────────
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    Say-Err "未检测到 Node.js，请先安装：https://nodejs.org/（LTS 即可）。"
    exit 1
}
$pnpm = Get-Command pnpm -ErrorAction SilentlyContinue
if (-not $pnpm) {
    Say-Err "未检测到 pnpm，请先执行：corepack enable"
    exit 1
}
Say-OK "node $(& node -v) / pnpm $(& pnpm -v)"

# ── 1) 本检出的应用服务在跑就先拦下来（AGENTS 硬规则 9）───────
# 判据与编排器的补装路径同一份实现（scripts\deps-install-guard.mjs →
# launcher-core/port-reap.mjs 的 runningAppInstances），本文件不再自己探端口。
Say-Info "前置检查：本检出有没有正在运行的应用服务"
Write-Host ">>> node scripts/deps-install-guard.mjs" -ForegroundColor Yellow
& node (Join-Path $PSScriptRoot "deps-install-guard.mjs")
if ($LASTEXITCODE -ne 0) {
    Say-Err "已停止：这个状态下装依赖会 EPERM 连锁失败（见上方判据给出的原因）。"
    Say-Info "关掉本检出的应用窗口（或停掉正在跑的 pnpm dev），再重新双击本入口即可。"
    exit 1
}
Say-OK "没有正在运行的应用服务，可以安全装依赖"

# ── 2) pnpm install（非交互，对齐 lockfile）────────────────
Say-Info "步骤 1/2：pnpm install"
# 命令行回显：与 .mjs 侧同一 `>>> ` 前缀（那侧的唯一出口是 launcher-core/command-echo.mjs）。
Write-Host ">>> pnpm install" -ForegroundColor Yellow
& pnpm install
$code = $LASTEXITCODE
if ($code -ne 0) {
    Say-Err "pnpm install 失败（exit $code）。"
    Say-Info "常见处理：先关闭运行中的本项目窗口（dev server 会锁原生模块），再重试；"
    Say-Info "若报 ERR_PNPM_IGNORED_BUILDS / ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION，"
    Say-Info "按 docs/guides/sync-after-pull.md 删掉 node_modules 后彻底重装。"
    exit $code
}
Say-OK "pnpm install 完成"

# ── 3) pnpm lint ───────────────────────────────────────────
Say-Info "步骤 2/2：pnpm lint"
Write-Host ">>> pnpm lint" -ForegroundColor Yellow
& pnpm lint
$code = $LASTEXITCODE
if ($code -ne 0) {
    Say-Err "pnpm lint 存在未通过的检查（exit $code），请修复上方报错后重跑。"
    Say-Info "也可执行 pnpm lint:fix 尝试自动修复格式类问题。"
    exit $code
}
Say-OK "pnpm lint 全部通过"
exit 0
