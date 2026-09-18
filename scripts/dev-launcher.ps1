#Requires -Version 5.1
<#
dev-launcher.ps1 — Windows 侧的**调用入口**（编排逻辑不在这里）

===============================================================================
编排的唯一实现是 scripts/dev-launcher.mjs（跨平台，见规范 §3）。本文件只做
三件事，且**只做**这三件事：

  1. 定位项目根（双击时 cwd 是脚本所在目录，不可依赖）；
  2. 把参数原样转交给 `node scripts/dev-launcher.mjs`；
  3. 透传退出码。

为什么不再自己编排：同一件「拉起一个能用的开发环境」曾有两套实现（Windows 的
.ps1 与 POSIX 的 .mjs），两套各自演进 → 平台间行为不一致；而「记得同步另一侧」
全靠自觉，漏同步是静默的。现在平台特有的部分只剩两处，都已收口：
  · 进程机制（Windows 走 taskkill）→ src/lib/process/kill-process-tree.ts
  · 入口形态（双击 .ps1 / 启动器 exe）→ 本文件与 scripts/entry-common.ps1

历史实现（1324 行、19 处 Windows 专属调用）已整体删除：它只作对照用，却会被
当成「另一条可走的路径」——留着就是邀请下一个人去改它。需要回溯用 git 历史。

参数（与 dev-launcher.mjs 同一套，直接透传）：
  -Prebuilt / -Tauri / -ColdStart / -NoOpen / -Port <n> / -Host <addr> /
  -ShellExe <path>

用法：
  pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\dev-launcher.ps1 -Prebuilt
  或经入口：tools\start\start-web.ps1 / tools\start\start-tauri-dev.ps1
#>
[CmdletBinding()]
param(
  # 开关与值分开声明：`.ps1` 的参数名是 PascalCase（PowerShell 惯例），
  # 而编排器认的是 kebab-case 的 CLI 开关，映射在下方 $argList 里显式做。
  [switch]$Prebuilt,
  [switch]$Tauri,
  [switch]$ColdStart,
  [switch]$NoOpen,
  [string]$Port,
  [string]$HostName = "",
  [string]$ShellExe = "",
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# scripts\ → 项目根：上溯一级；本文件就在 scripts\ 下，直接取其父目录。
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $root

$launcher = Join-Path $root "scripts\dev-launcher.mjs"
if (-not (Test-Path -LiteralPath $launcher)) {
  Write-Host "[ERROR] 未找到启动编排器：scripts\dev-launcher.mjs" -ForegroundColor Red
  Write-Host "        它是启动链路的唯一实现（见 docs/standards/launch-and-build.md §3）。" -ForegroundColor Red
  exit 1
}

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Host "[ERROR] 未找到 node：启动编排器需要 Node.js 22+。" -ForegroundColor Red
  Write-Host "        安装后重试，或直接运行 pnpm dev。" -ForegroundColor Red
  exit 1
}

$argList = @($launcher)
if ($Prebuilt)  { $argList += @("--mode", "prebuilt") }
if ($Tauri)     { $argList += @("--mode", "tauri") }
if ($ColdStart) { $argList += "--cold-start" }
if ($NoOpen)    { $argList += "--no-open" }
if ($Port)      { $argList += @("--port", $Port) }
if ($HostName)  { $argList += @("--host", $HostName) }
if ($ShellExe)  { $argList += @("--shell-exe", $ShellExe) }

if ($DryRun) {
  Write-Host ("[INFO] 将调用：node " + ($argList -join " ")) -ForegroundColor Cyan
  exit 0
}

# -NoNewWindow -Wait：日志留在当前窗口，退出码原样带回（与调用方的收尾语义一致）。
$proc = Start-Process -FilePath $node.Source -ArgumentList $argList `
  -WorkingDirectory $root -NoNewWindow -Wait -PassThru
exit [int]$proc.ExitCode
