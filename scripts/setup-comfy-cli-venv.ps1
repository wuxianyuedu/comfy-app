#Requires -Version 5.1
<#
setup-comfy-cli-venv.ps1 — 准备 comfy-cli 的 Python 虚拟环境（Windows 薄壳入口）
===============================================================================
ISSUE #2197：逻辑全部搬进 scripts/setup-comfy-cli-venv.mjs（跨平台唯一实现 ——
读侧 src/lib/comfyui/comfy-cli-python.ts 早就按平台认 Scripts|bin 布局，缺的只有
「建」这一格的 POSIX 入口）。本文件按硬规则 12 的既定形状只做两件事：
定位项目根 → 调用那个 .mjs 并透传参数；**不得**再长出任何编排逻辑
（节流 / 升级 / venv 判断都住在 .mjs 里，由 check-ps1-consistency.mjs 守着两边不漂）。

用法（等价）：
  pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\setup-comfy-cli-venv.ps1 [-Force]
  node scripts/setup-comfy-cli-venv.mjs [--force]
#>
param(
  # 跳过 24h 节流，立即检查并升级（透传给 .mjs 的 --force）
  [switch]$Force
)

$ErrorActionPreference = "Stop"
$nodeExe = (Get-Command node -ErrorAction Stop).Source
$script = Join-Path $PSScriptRoot "setup-comfy-cli-venv.mjs"

$argv = @($script)
if ($Force) { $argv += "--force" }

& $nodeExe @argv
exit $LASTEXITCODE
