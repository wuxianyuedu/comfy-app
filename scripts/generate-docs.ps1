#Requires -Version 5.1
<#
generate-docs.ps1 - Comfy-APP-T3 文档生成 / 一致性校验逻辑脚本
===============================================================================
供 tools\docs\generate-docs.ps1 入口双击调用，职责：
  1. pnpm doc:check   校验编辑文档的占位符/裸值/路径与权威源码一致；
  2. pnpm doc:render  把占位符替换为从源码实时提取的真实值，输出 docs/generated/。

背景（ISSUE #242）：文档里硬编码值（端口/路径/exe 名）随代码变动易遗漏。
单一事实在源码/配置；编辑文档用占位符 + doc:check 防裸值回潮，生成文档由
doc:render 动态产出原文供直接阅读。本脚本把这两步封装成傻瓜式可执行工具。

Usage:
  双击 tools\docs\generate-docs.ps1
  或 powershell -NoProfile -ExecutionPolicy Bypass -File scripts\generate-docs.ps1

设计要点：
  - 先 check 再 render：只有编辑文档与权威源一致，生成原文才有意义；
    任一步失败即非零退出，并在 stdout 给出下一步指引。
  - 不写 log\tools\ 固定名日志（生成文档是轻量、高频操作，无需进程句柄落盘）。
#>
param()

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Say-OK   { Write-Host "[OK]   " -NoNewline -ForegroundColor Green; Write-Host "$args" }
function Say-Info { Write-Host "[INFO] " -NoNewline -ForegroundColor Cyan;  Write-Host "$args" }
function Say-Warn { Write-Host "[WARN] " -NoNewline -ForegroundColor Yellow; Write-Host "$args" }
function Say-Err  { Write-Host "[ERROR]" -NoNewline -ForegroundColor Red;    Write-Host "$args" }

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Say-Err "未检测到 Node.js，请先安装：https://nodejs.org/（LTS 即可）。"
    exit 1
}
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    Say-Err "未检测到 pnpm，请先执行：corepack enable"
    exit 1
}
if (-not (Test-Path -LiteralPath (Join-Path $root "node_modules\.bin"))) {
    Say-Err "未检测到 node_modules\.bin，请先在项目根执行：pnpm install"
    exit 1
}
Say-OK "node $(& node -v) / pnpm $(& pnpm -v)"

Say-Info "步骤 1/2：文档引用一致性校验（pnpm doc:check）"
& pnpm doc:check
$code = $LASTEXITCODE
if ($code -ne 0) {
    Say-Err "文档引用校验未通过（exit $code）。"
    Say-Info "请按上方报错，检查编辑文档里的占位符/裸值/路径是否与权威源一致。"
    exit $code
}
Say-OK "文档引用一致性通过"

Say-Info "步骤 2/2：生成原文文档（pnpm doc:render）"
& pnpm doc:render
$code = $LASTEXITCODE
if ($code -ne 0) {
    Say-Err "文档生成失败（exit $code）。"
    Say-Info "请确认权威源文件存在、doc-facts.cjs 的 extract 规则能读到值。"
    exit $code
}
Say-OK "原文文档已生成到 docs\generated\"

exit 0
