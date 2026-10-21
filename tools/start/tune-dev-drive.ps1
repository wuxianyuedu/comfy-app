#Requires -Version 5.1
<#
tune-dev-drive.ps1 — 开发盘（ReFS / Dev Drive）红利探测与调优（双击用）

===============================================================================
给「仓库搬到开发盘之后，怎么把这块盘的红利吃满」这件事一个**可复跑的入口**：
双击本脚本即调 `node scripts/dev-drive-tune.mjs`（= `pnpm dev:drive`），由后者
实测这块卷的能力（硬链接 / 块克隆 / 稀疏文件），再给出一张动作矩阵。

为什么要有这个入口（而不是把结论写进文档就完事）：
  · 「卷是 ReFS」与「卷是 Dev Drive」是两件事 —— 块克隆自 Windows 11 24H2 起
    只对**被指定为开发驱动器的卷**开放，普通 ReFS 卷探出来是「不支持」；
    这条差别靠文档说不清，只能靠实测，而实测要能随时重跑。
  · 开发盘上的落点（依赖缓存、临时目录、Defender 排除项）会随机器配置漂移，
    写死的结论一漂就变成误导。

逻辑不在本文件：跨平台实现是 `scripts/dev-drive-tune.mjs`（规范 §9.5），
本入口只做「定位项目根 → 调它 → 透传退出码」。

入口**不会**替你做需要管理员权限或会动数据的动作（Defender 排除项、
把卷按 Dev Drive 格式化）：那些只会被打印成命令，判定权在人。

用法：
  双击 <项目根>\tools\start\tune-dev-drive.ps1
  或在终端执行：pwsh -NoProfile -ExecutionPolicy Bypass -File .\tools\start\tune-dev-drive.ps1
  带参数：      pwsh -NoProfile -ExecutionPolicy Bypass -File .\tools\start\tune-dev-drive.ps1 -Apply
  跑 I/O 实测： pwsh -NoProfile -ExecutionPolicy Bypass -File .\tools\start\tune-dev-drive.ps1 -Bench

依赖：本机需先装好 Node（跨平台入口 `pnpm dev:drive` 同形）。
#>
[CmdletBinding()]
param(
  # 落仓库级（可逆）调优：git 索引格式与提交图。默认只探测与报告。
  [switch]$Apply,
  # 机器可读输出（JSON），供其他工具消费。
  [switch]$Json,
  # 跑一次 I/O 实测：同一段负载测开发盘与参考盘，并归因「谁在吃 CPU」。
  # 这一档会真的写数据（每块盘几百 MB，跑完即删），默认不跑。
  [switch]$Bench
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# tools\start\ → 项目根：交给公共库按标记文件上溯定位（入口将来挪位置不用改这里）
. (Join-Path $PSScriptRoot "..\..\scripts\entry-common.ps1")
$root = Get-ProjectRoot -StartDir $PSScriptRoot
Set-Location $root

$script = Join-Path $root "scripts\dev-drive-tune.mjs"
if (-not (Test-Path -LiteralPath $script)) {
    Write-Host "[ERROR] 未找到调优脚本：scripts\dev-drive-tune.mjs" -ForegroundColor Red
    exit 1
}

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    Write-Host "[ERROR] 未找到 node：开发盘调优需要 Node.js。" -ForegroundColor Red
    Write-Host "        装好 Node 后重试，或直接运行 pnpm dev:drive。" -ForegroundColor Red
    exit 1
}

$nodeArgs = @($script)
if ($Apply) { $nodeArgs += "--apply" }
if ($Json) { $nodeArgs += "--json" }
if ($Bench) { $nodeArgs += "--bench" }

Write-Host ">>> node $($nodeArgs -join ' ')" -ForegroundColor Yellow

# -NoNewWindow -Wait：输出留在当前窗口，退出码原样带回（与 tools\docs\generate-api-docs.ps1 同形）。
$proc = Start-Process -FilePath $node.Source -ArgumentList $nodeArgs `
    -WorkingDirectory $root -NoNewWindow -Wait -PassThru
$code = [int]$proc.ExitCode

if ($code -ne 0) {
    Write-Host "" -ForegroundColor Red
    Write-Host "[ERROR] 开发盘探测未通过（退出码 $code）。上面每一行都写了判据与动作，照着处理即可。" -ForegroundColor Red
    exit (Complete-Entry -ExitCode $code)
}
exit (Complete-Entry -ExitCode $code -SuccessMessage "开发盘红利探测完成（上面的动作矩阵就是要做的事）。")
