#Requires -Version 5.1
<#
entry-common.ps1 — 双击入口公共库（供根入口与 tools/<分类>/ 下的 .ps1 引用）

===============================================================================
背景：仓库内所有 Windows 双击入口曾经是 .bat，只做一件事——调用同名的 PowerShell
逻辑脚本。.bat 走 cmd.exe（GBK 代码页），中文提示与子进程 UTF-8 输出必然乱码，
于是历史上被迫「bat 里不写中文、逻辑全塞 ps1」，等于把入口变成哑壳。
2026-09-04 起入口本身也改成 .ps1（见 docs/standards/launch-and-build.md §8），
本库把这些入口共有的三件事收敛到一处：

  1. 定位项目根、把工作目录切过去（双击时 cwd 是脚本所在目录，不可依赖）；
  2. 解析要用的 PowerShell 宿主（优先 pwsh 7，回退 Windows PowerShell 5.1）；
  3. 在同一窗口内调用逻辑脚本、透传参数、透传退出码，失败给出中文提示并等待按键。

用法（入口脚本里）：

    . (Join-Path $PSScriptRoot "scripts\entry-common.ps1")
    $code = Invoke-Entry -ScriptPath "scripts\dev-launcher.ps1"   # 薄入口，编排在 .mjs
    exit (Complete-Entry -ExitCode $code)

约定：
  - 入口脚本只做「定位 + 调用 + 收尾」，业务逻辑一律在 scripts/ 或 tools/scripts/
    下的逻辑脚本里，与旧 .bat 的职责划分保持一致。
  - 所有入口都返回逻辑脚本的真实退出码，方便 CI/终端判断成败。
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

<#
.SYNOPSIS
  返回本仓库的项目根目录（tools/<分类>/ 下入口的上两级，或根入口本身所在目录）。
.DESCRIPTION
  支持三种布局（2026-09-04 起根入口也迁入 tools/start/，见 ISSUE #29）：
    - 工具入口：<项目根>\tools\build\build-all.ps1  → 根目录是 $PSScriptRoot 的上两级
    - 启动入口：<项目根>\tools\start\start-web.ps1   → 同样是上两级
    - 根入口  ：<项目根>\start-web.ps1             → 根目录即 $PSScriptRoot（历史布局）
  判定依据：目录下存在 scripts\dev-launcher.mjs（本仓库唯一的启动编排器；
  入口与其按层数硬算，不如逐级上溯找标记文件——入口将来再挪位置也不用改这里）。
#>
function Get-ProjectRoot {
  param(
    [string]$StartDir = $PSScriptRoot
  )

  $marker = "scripts\dev-launcher.mjs"
  $dir = (Resolve-Path -LiteralPath $StartDir).Path
  for ($i = 0; $i -lt 4; $i++) {
    if (Test-Path -LiteralPath (Join-Path $dir $marker)) { return $dir }
    $parent = Split-Path -Parent $dir
    if ([string]::IsNullOrEmpty($parent) -or $parent -eq $dir) { break }
    $dir = $parent
  }
  throw "未能定位项目根目录（未找到 $marker 标记文件）。请把本入口放在仓库内再运行。"
}

<#
.SYNOPSIS
  解析用于执行逻辑脚本的 PowerShell 宿主：优先 pwsh 7，回退 powershell.exe。
.DESCRIPTION
  不指定绝对路径而是交给 Get-Command 解析，避免硬编码
  C:\Program Files\PowerShell\7\pwsh.exe 这类随安装方式漂移的路径。
#>
function Get-Pwsh {
  $pwsh = Get-Command pwsh -ErrorAction SilentlyContinue
  if ($pwsh) { return $pwsh.Source }
  $ps = Get-Command powershell.exe -ErrorAction SilentlyContinue
  if ($ps) { return $ps.Source }
  return "powershell.exe"
}

<#
.SYNOPSIS
  在同一控制台窗口内调用逻辑脚本，透传参数与退出码。
.PARAMETER Root
  项目根目录；省略时自动探测。
.PARAMETER ScriptPath
  逻辑脚本相对项目根的路径，如 scripts\dev-launcher.ps1。
.PARAMETER ScriptArgs
  透传给逻辑脚本的参数数组。
.PARAMETER HideWindow
  后台启动（不等待、不占用当前窗口），用于启动桌面壳这类长驻进程。
  返回被启动的 Process 对象；不再配合 Complete-Entry 使用。
.PARAMETER NodeScript
  以 node 逻辑脚本（.mjs）为调用对象：除 -Root / -FilePath / -ScriptArgs 外不再
  包一层 PowerShell 宿主。启动编排器是 scripts/dev-launcher.mjs —— 它是
  **全平台唯一实现**，`.ps1` 只做「定位项目根 → 调它 → 透传退出码」。
#>
function Invoke-Entry {
  param(
    [string]$Root = "",
    [Parameter(Mandatory = $true)][string]$ScriptPath,
    [string[]]$ScriptArgs = @(),
    [switch]$HideWindow
  )

  if (-not $Root) { $Root = Get-ProjectRoot }
  $abs = Join-Path $Root $ScriptPath
  if (-not (Test-Path -LiteralPath $abs)) {
    Write-Host "[ERROR] 未找到逻辑脚本：$ScriptPath" -ForegroundColor Red
    Write-Host "        期望位置：$abs" -ForegroundColor Red
    return 1
  }

  if ($NodeScript) {
    return (Invoke-NodeEntry -Root $Root -ScriptPath $ScriptPath -ScriptArgs $ScriptArgs -HideWindow:$HideWindow)
  }

  $psExe = Get-Pwsh
  # -NoProfile 避免加载用户 profile 引入不确定行为；-ExecutionPolicy Bypass 让
  # 双击场景不必先手工改机器的执行策略。子脚本自己负责中文输出编码。
  $argList = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$abs`"") + $ScriptArgs

  if ($HideWindow) {
    return (Start-Process -FilePath $psExe -ArgumentList $argList `
        -WorkingDirectory $Root -WindowStyle Hidden -PassThru)
  }

  # -NoNewWindow + -Wait：日志留在当前窗口，退出码能原样带回（等价于旧 .bat 的 call）。
  $proc = Start-Process -FilePath $psExe -ArgumentList $argList `
    -WorkingDirectory $Root -NoNewWindow -Wait -PassThru
  return [int]$proc.ExitCode
}

<#
.SYNOPSIS
  以 node 直接调用跨平台逻辑脚本（.mjs），把入口缩成「定位 + 调用 + 收尾」。
.DESCRIPTION
  启动编排的唯一实现是 scripts/dev-launcher.mjs：平台特有的只有进程机制与
  入口形态，脚本本身不分平台。`.ps1` 因此不再承担任何编排逻辑——它只负责
  「Windows 侧怎么被双击/被 exe 拉起」这件事（见规范 §8、§3）。

  node 由 Get-Command 解析（不硬编码安装路径）；找不到时给可行动的中文提示。
#>
function Invoke-NodeEntry {
  param(
    [string]$Root = "",
    [Parameter(Mandatory = $true)][string]$ScriptPath,
    [string[]]$ScriptArgs = @(),
    [switch]$HideWindow
  )

  if (-not $Root) { $Root = Get-ProjectRoot }
  $abs = Join-Path $Root $ScriptPath
  if (-not (Test-Path -LiteralPath $abs)) {
    Write-Host "[ERROR] 未找到逻辑脚本：$ScriptPath" -ForegroundColor Red
    Write-Host "        期望位置：$abs" -ForegroundColor Red
    return 1
  }

  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) {
    Write-Host "[ERROR] 未找到 node（启动编排器 scripts/dev-launcher.mjs 需要它）。" -ForegroundColor Red
    Write-Host "        请安装 Node.js 22+ 后重试；或直接运行 pnpm dev。" -ForegroundColor Red
    return 1
  }

  $argList = @("`"$abs`"") + $ScriptArgs
  if ($HideWindow) {
    return (Start-Process -FilePath $node.Source -ArgumentList $argList `
        -WorkingDirectory $Root -WindowStyle Hidden -PassThru)
  }
  $proc = Start-Process -FilePath $node.Source -ArgumentList $argList `
    -WorkingDirectory $Root -NoNewWindow -Wait -PassThru
  return [int]$proc.ExitCode
}

<#
.SYNOPSIS
  入口脚本统一收尾：失败打印中文提示，双击场景（非终端调用）等待按键后退出。
.DESCRIPTION
  双击判据沿用旧 .bat 的 $env:cmdcmdline 检测：由资源管理器拉起时该变量为空，
  说明窗口是临时弹出的、退出即消失，必须暂停才能让使用者读到提示。
#>
function Complete-Entry {
  param(
    [int]$ExitCode = 0,
    [string]$SuccessMessage = ""
  )

  if ($ExitCode -ne 0) {
    Write-Host ""
    Write-Host "[ERROR] 执行失败，退出码 $ExitCode 。请阅读上方提示后处理。" -ForegroundColor Red
    if (Test-IsDoubleClicked) {
      Write-Host ""
      Read-Host "按回车键关闭窗口"
    }
    return $ExitCode
  }

  if ($SuccessMessage) {
    Write-Host ""
    Write-Host "[OK] $SuccessMessage" -ForegroundColor Green
  }
  if (Test-IsDoubleClicked) {
    Write-Host ""
    Write-Host "============================================" -ForegroundColor DarkGray
    Write-Host "  执行结束，按回车键关闭窗口。" -ForegroundColor DarkGray
    Write-Host "============================================" -ForegroundColor DarkGray
    Read-Host "按回车键关闭窗口"
  }
  return 0
}

<#
.SYNOPSIS
  判断本次运行是否为「双击启动」（而不是在已有终端里敲命令）。
#>
function Test-IsDoubleClicked {
  # 资源管理器双击 .ps1 时，用 powershell.exe 拉起一个新窗口，父进程是 explorer；
  # 此时 $env:cmdcmdline 未设置。从 cmd/pwsh 终端调用时该变量存在或被显式清空过，
  # 统一以「变量为空且父进程是 explorer」作为双击判据，避免误暂停 CI/终端场景。
  if ($env:cmdcmdline) { return $false }
  try {
    $parent = (Get-CimInstance -ClassName Win32_Process -Filter "ProcessId=$PID" `
        -ErrorAction SilentlyContinue).ParentProcessId
    if (-not $parent) { return $false }
    $parentName = (Get-Process -Id $parent -ErrorAction SilentlyContinue).ProcessName
    return ($parentName -eq "explorer")
  } catch {
    return $false
  }
}
