#Requires -Version 5.1
<#
generate-api-docs.ps1 — 一键重生成 API 文档（docs\api，双击用）

===============================================================================
给「改了 src/lib|server|trpc 要同步 docs/api」的场景：双击本脚本即调
`node scripts/generate-api-docs.mjs`（= `pnpm run docs`），由后者调 typedoc 重生成
docs\api\**，并且**验产物真的被这一轮重写了**才收尾。

为什么不再直接跑 typedoc：它写出失败时照样退 0、日志照样收在
`[info] html generated at …` 上 —— 现场是「退出码 0 + 说生成了 + 产物一个没更新」，
下一次有人发现已经是「翻 docs\api 看到它过期」。现在那层会验（`index.html` 是不是
这一轮写的）、会重试（Windows 上目录被占用多半是瞬时失败），全失败才退非零。
判据与完整背景见 scripts\typedoc-run.mjs 的文件头。

逻辑不在本文件：跨平台实现是 scripts\generate-api-docs.mjs（规范 §9.5），
本入口只做「定位项目根 → 调它 → 透传退出码」。

前置（一次性）：Windows 默认双击 .ps1 是「用记事本打开」，需先右键
scripts\enable-ps1-double-click.ps1 选择「使用 PowerShell 运行」完成关联。

用法：
  双击 <项目根>\tools\docs\generate-api-docs.ps1
  或在终端执行：pwsh -NoProfile -ExecutionPolicy Bypass -File .\tools\docs\generate-api-docs.ps1

依赖：本机需先装好 Node + pnpm，并已在项目根执行过 pnpm install。
#>
[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# tools\docs\ → 项目根：交给公共库按标记文件上溯定位（入口将来挪位置不用改这里）
. (Join-Path $PSScriptRoot "..\..\scripts\entry-common.ps1")
$root = Get-ProjectRoot -StartDir $PSScriptRoot
Set-Location $root

$script = Join-Path $root "scripts\generate-api-docs.mjs"
if (-not (Test-Path -LiteralPath $script)) {
    Write-Host "[ERROR] 未找到生成脚本：scripts\generate-api-docs.mjs" -ForegroundColor Red
    exit 1
}

$node = Get-Command node -ErrorActionPreference SilentlyContinue
if (-not $node) {
    Write-Host "[ERROR] 未找到 node：生成 API 文档需要 Node.js。" -ForegroundColor Red
    Write-Host "        安装后重试，或直接运行 pnpm run docs。" -ForegroundColor Red
    exit 1
}

Write-Host "[INFO] 开始重生成 API 文档（docs\api）..." -ForegroundColor Cyan
Write-Host ">>> node `"$script`"" -ForegroundColor Yellow

# -NoNewWindow -Wait：日志留在当前窗口，退出码原样带回（与 scripts\dev-launcher.ps1 同形）。
$proc = Start-Process -FilePath $node.Source -ArgumentList @($script) `
    -WorkingDirectory $root -NoNewWindow -Wait -PassThru
$code = [int]$proc.ExitCode

if ($code -ne 0) {
    Write-Host "[ERROR] API 文档未更新（退出码 $code）。常见原因是 docs\api 下仍有文件被占用（EPERM / EBUSY）。" -ForegroundColor Red
    Write-Host "        关掉占用它的编辑器 / 残留进程后重跑，或 pnpm run docs --out <其他目录> 比对。" -ForegroundColor Red
    exit (Complete-Entry -ExitCode $code)
}
exit (Complete-Entry -ExitCode $code -SuccessMessage "API 文档已重生成到 docs\api\（可连同源码一起提交）。")
