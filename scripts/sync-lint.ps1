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
  - 注意：若 dev server（3000 端口）正在运行，pnpm install 可能因 better-sqlite3
    等原生模块被进程锁定而 EPERM。此时先打印提示，仍尝试安装；失败则明确给出
    「先关闭本项目窗口再重试」的指引（见 docs/standards/launch-and-build.md §3/§5）。
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

# ── 1) 检测 dev server 占用（install 可能 EPERM 的前置提醒）────
function Test-PortListening {
  param([int]$Port)
  try {
    $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    return ($null -ne $conn)
  } catch { return $false }
}
$devRunning = (Test-PortListening 3000) -or (Test-PortListening 3001) -or (Test-PortListening 3002)
if ($devRunning) {
    Say-Warn "检测到本项目 dev server 可能仍在运行（3000/3001/3002 端口被监听）。"
    Say-Warn "pnpm install 可能因 better-sqlite3 等原生模块被进程锁定而失败（EPERM）。"
    Say-Warn "若下方安装报错，请先关闭所有本项目窗口，再重新双击本脚本。"
}

# ── 2) pnpm install（非交互，对齐 lockfile）────────────────
Say-Info "步骤 1/2：pnpm install"
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
& pnpm lint
$code = $LASTEXITCODE
if ($code -ne 0) {
    Say-Err "pnpm lint 存在未通过的检查（exit $code），请修复上方报错后重跑。"
    Say-Info "也可执行 pnpm lint:fix 尝试自动修复格式类问题。"
    exit $code
}
Say-OK "pnpm lint 全部通过"
exit 0
