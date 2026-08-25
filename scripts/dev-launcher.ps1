# dev-launcher.ps1 — 用 Windows Job Object 启动开发服务器
# 原理：把 npm 进程及其所有子进程挂到同一个 Job 对象上，
#       并设置「关闭窗口时自动杀掉整个 Job」，从而实现关窗口零残留。
# 用法：pwsh -ExecutionPolicy Bypass -File scripts\dev-launcher.ps1 [-Tauri]
# 日志：
#   - 本次运行日志：log/dev-launcher.log（每次运行覆盖）
#   - 按日累积日志：log/dev-launcher-YYYY-MM-DD.log（每次运行完整追加）
#
# 改进（2026-08-04）：启动前按端口「精准」杀掉残留的 dev server，
#   彻底避免「旧实例占着 3000、新实例被挤到 3001、浏览器连着旧代码」的尴尬。
# 改进（2026-08-23）：.next 缓存改为「指纹优先」策略——默认不再每次清空 .next，
#   而是计算关键配置指纹（next.config.js / tsconfig.json / package.json /
#   pnpm-lock.yaml 内容 hash），与 .next\config-fingerprint 记录值比对：
#   一致则保留缓存直接启动（秒起），不一致才清空 .next 全量重编译并写入新指纹。
#   彻底摆脱「每次启动慢 30~60s」与「编译产物缓存了旧 route.ts / API schema
#   看不到改动」两个问题。
# 改进（2026-08-25）：
#   1) 指纹不再包含 src\trpc / src\server 源码目录内容 hash——源码改动由
#      Turbopack 增量编译 + HMR 处理，无需清缓存；把源码纳入指纹会导致
#      「每改一行 API 代码就清空 .next 全量重编译」的慢启动。
#   2) 日志输出重构：统一 [时间] [级别]（STEP/OK/WARN/ERROR/INFO）格式与
#      颜色分级，步骤进度 + 启动摘要卡片，终端可读性与日志审计性兼顾。
#   3) 日志目录改为项目根目录 log/，同时维护本次运行文件与按日累积文件，
#      便于应用内日志面板读取启动全过程。
#   控制开关（优先级 FORCE_CLEAN > SKIP_CLEAN > 指纹判断）：
#     - SKIP_CLEAN=1  强制跳过清理（无论指纹如何都保留缓存，最快启动）
#     - FORCE_CLEAN=1 强制清理（无论指纹如何都清空 .next 全量重编译）
#     - NO_OPEN=1     不自动打开浏览器
#   启动 Ready 后会自动打开/聚焦浏览器 http://localhost:3000：
#     - 普通重启：Next 的 HMR 会自动重载已有标签页，无需手动硬刷；
#     - 默认启动会带缓存破坏参数开新标签页，避免旧的 stale chunk 残留。
#   若浏览器已有 Comfy-APP 旧标签页，请顺手关掉（sessionStorage 缓存按 tab
#   隔离，缓存键版本虽已升到 v2 永久作废旧缓存，但关掉旧 tab 是最直观的保险）。

param(
  [switch]$Tauri   # 传 -Tauri 时启动 Tauri 桌面壳（pnpm tauri dev），否则启动 Web dev server
)

$ErrorActionPreference = "Stop"

# ── 日志目录与文件 ──
$logDir = Join-Path $PSScriptRoot "..\log"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
$currentLog = Join-Path $logDir "dev-launcher.log"
$dailyLog = Join-Path $logDir ("dev-launcher-" + (Get-Date -Format "yyyy-MM-dd") + ".log")

# 本次运行日志：覆盖清空
Set-Content -Path $currentLog -Value "" -Encoding utf8 -Force
# 按日累积：开始追加本次运行的分隔标记
$runStartMarker = "===== 运行开始 {0} =====" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss")
Add-Content -Path $dailyLog -Value $runStartMarker -Encoding utf8

# 开启 Transcript，把控制台所有输出（含子进程）同步写入本次运行日志
Start-Transcript -Path $currentLog -Force -ErrorAction SilentlyContinue | Out-Null

# ── 日志输出：统一 [时间] [级别] 格式，颜色分级 ──
#   级别：STEP（步骤进度/青）、OK（成功/绿）、WARN（警告/黄）、ERROR（错误/红）、INFO（详情/灰）
function Write-Log {
  param(
    [Parameter(Mandatory = $true)][string]$Message,
    [ValidateSet("STEP", "OK", "WARN", "ERROR", "INFO")][string]$Level = "INFO"
  )
  $color = @{ STEP = "Cyan"; OK = "Green"; WARN = "Yellow"; ERROR = "Red"; INFO = "DarkGray" }[$Level]
  $time = Get-Date -Format "HH:mm:ss"
  Write-Host ("[{0}] [{1,-5}] {2}" -f $time, $Level, $Message) -ForegroundColor $color
}

# ── 启动摘要卡片：标题 + 键值信息，分隔线包裹 ──
function Show-Summary {
  param(
    [Parameter(Mandatory = $true)][string]$Title,
    [Parameter(Mandatory = $true)][string[]]$Lines
  )
  $rule = "─" * 64
  Write-Host ""
  Write-Host $rule -ForegroundColor Cyan
  Write-Host ("  {0}" -f $Title) -ForegroundColor Cyan
  Write-Host $rule -ForegroundColor Cyan
  foreach ($line in $Lines) { Write-Host ("  " + $line) -ForegroundColor White }
  Write-Host $rule -ForegroundColor Cyan
  Write-Host ""
}

# ── 启动前清理：按端口精准杀掉残留 dev server（不误伤其它 node 进程）──
#     只杀真正占用 3000/3001/3002 的进程，不影响你后台跑的其它程序。
function Stop-ProcessOnPort($port) {
  try {
    $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if (-not $conns) { return }
    $ids = @($conns.OwningProcess) | Sort-Object -Unique
    foreach ($id in $ids) {
      try {
        $proc = Get-Process -Id $id -ErrorAction SilentlyContinue
        if ($proc) {
          Write-Log ("端口 {0} 被 PID {1} ({2}) 占用，正在终止..." -f $port, $id, $proc.ProcessName) -Level WARN
          # 先尝试优雅退出，再强制
          $proc.CloseMainWindow() | Out-Null
          Stop-Process -Id $id -Force -ErrorAction SilentlyContinue
        }
      } catch { }
    }
    # 等端口真正释放，避免 next 启动时又抢到 3001
    Start-Sleep -Milliseconds 1000
  } catch { }
}

Write-Log "检查端口占用（3000/3001/3002）..." -Level STEP
foreach ($p in @(3000, 3001, 3002)) { Stop-ProcessOnPort $p }
Write-Log "端口已就绪，将启动全新实例于 3000" -Level OK

# ── .next 缓存策略：基于「关键配置指纹」决定是否全量重编译 ──
#     指纹 = SHA256 累积 next.config.js / tsconfig.json / package.json /
#            pnpm-lock.yaml 内容（仅构建配置与依赖，不含源码）。
#     指纹与 .next\config-fingerprint 一致 → 保留 .next 直接启动（秒起）；
#     不一致 → 清空 .next 全量重编译并写入新指纹。
#     源码（src\**）改动不纳入指纹：Turbopack 增量编译 + HMR 足够，清缓存反而慢。
#     控制开关（优先级 FORCE_CLEAN > SKIP_CLEAN > 指纹判断）：
#       FORCE_CLEAN=1 强制清理（无视指纹与 SKIP_CLEAN）
#       SKIP_CLEAN=1  强制跳过清理（保留缓存，最快启动）
function Get-ConfigFingerprint {
  $root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
  $targets = @("next.config.js", "tsconfig.json", "package.json", "pnpm-lock.yaml")
  $ih = [System.Security.Cryptography.IncrementalHash]::CreateHash(
    [System.Security.Cryptography.HashAlgorithmName]::SHA256)
  foreach ($rel in $targets) {
    $full = Join-Path $root $rel
    if (-not (Test-Path $full)) { continue }
    $ih.AppendData([System.Text.Encoding]::UTF8.GetBytes($rel + "`0"))
    if ((Get-Item $full).PSIsContainer) {
      $files = @(Get-ChildItem $full -Recurse -File -ErrorAction SilentlyContinue |
                 Sort-Object FullName)
      foreach ($f in $files) {
        $relPath = $f.FullName.Substring($root.Length).TrimStart('\')
        $ih.AppendData([System.Text.Encoding]::UTF8.GetBytes($relPath + "`0"))
        $ih.AppendData([System.IO.File]::ReadAllBytes($f.FullName))
      }
    } else {
      $ih.AppendData([System.IO.File]::ReadAllBytes($full))
    }
  }
  return [System.BitConverter]::ToString($ih.GetHashAndReset()).Replace("-", "").ToLowerInvariant()
}

$nextDir = Join-Path $PSScriptRoot "..\.next"
$fingerprint = Get-ConfigFingerprint
$fingerprintFile = Join-Path $nextDir "config-fingerprint"

if ($env:FORCE_CLEAN -eq "1") {
  if (Test-Path $nextDir) {
    $nextSize = (Get-ChildItem $nextDir -Recurse -File -ErrorAction SilentlyContinue |
                 Measure-Object Length -Sum).Sum
    $sizeMB = if ($nextSize) { [math]::Round($nextSize / 1MB, 1) } else { 0 }
    Write-Log ("FORCE_CLEAN=1：强制清空 .next（{0} MB）并全量重编译..." -f $sizeMB) -Level STEP
    Remove-Item -Recurse -Force $nextDir -ErrorAction SilentlyContinue
  } else {
    Write-Log "FORCE_CLEAN=1：.next 不存在，无需清理" -Level INFO
  }
  New-Item -ItemType Directory -Path $nextDir -Force | Out-Null
  Set-Content -Path $fingerprintFile -Value $fingerprint -Encoding utf8
  Write-Log "已清空 .next 并写入新配置指纹" -Level OK
} elseif ($env:SKIP_CLEAN -eq "1") {
  Write-Log "SKIP_CLEAN=1：跳过 .next 清理（保留编译缓存，最快启动）" -Level INFO
} elseif (Test-Path $nextDir) {
  $saved = ""
  if (Test-Path $fingerprintFile) { $saved = (Get-Content $fingerprintFile -Raw).Trim() }
  if ($saved -eq $fingerprint) {
    Write-Log ("配置指纹未变（{0}），保留 .next 缓存，直接启动" -f $fingerprint) -Level OK
  } else {
    $nextSize = (Get-ChildItem $nextDir -Recurse -File -ErrorAction SilentlyContinue |
                 Measure-Object Length -Sum).Sum
    $sizeMB = if ($nextSize) { [math]::Round($nextSize / 1MB, 1) } else { 0 }
    Write-Log ("配置指纹变化（旧 {0} → 新 {1}），清空 .next（{2} MB）全量重编译..." -f $saved, $fingerprint, $sizeMB) -Level STEP
    Remove-Item -Recurse -Force $nextDir -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Path $nextDir -Force | Out-Null
    Set-Content -Path $fingerprintFile -Value $fingerprint -Encoding utf8
    Write-Log "已清空 .next 并写入新配置指纹" -Level OK
  }
} else {
  New-Item -ItemType Directory -Path $nextDir -Force | Out-Null
  Set-Content -Path $fingerprintFile -Value $fingerprint -Encoding utf8
  Write-Log ("首次启动：写入初始配置指纹（{0}），执行全量编译" -f $fingerprint) -Level STEP
}

try {
  # ── 第一步：定义 C# 互操作类，调用 kernel32 的 Job Object API ──
  Write-Log "创建 Windows Job Object（进程容器）..." -Level STEP
  $sig = @"
using System;
using System.Runtime.InteropServices;
public class WJ {
  [DllImport("kernel32.dll", CharSet=CharSet.Auto)]
  public static extern IntPtr CreateJobObject(IntPtr a, string n);
  [DllImport("kernel32.dll")]
  public static extern bool AssignProcessToJobObject(IntPtr j, IntPtr p);
  [DllImport("kernel32.dll")]
  public static extern bool SetInformationJobObject(IntPtr c, int i, IntPtr x, int l);
  [DllImport("kernel32.dll")]
  public static extern bool CloseHandle(IntPtr h);
}
"@
  Add-Type -TypeDefinition $sig -Language CSharp -ErrorAction Stop

  # ── 第二步：创建 Job 对象 ──
  $h = [WJ]::CreateJobObject([IntPtr]::Zero, $null)
  if ($h -eq [IntPtr]::Zero) { throw "CreateJobObject 返回空句柄" }
  Write-Log "Job Object 创建成功" -Level OK

  # ── 第三步：设置「关闭窗口即终止」标志（0x2000 = KILL_ON_JOB_CLOSE）──
  $m = [System.Runtime.InteropServices.Marshal]::AllocHGlobal(4)
  [System.Runtime.InteropServices.Marshal]::WriteInt32($m, 0x2000)
  $null = [WJ]::SetInformationJobObject($h, 7, $m, 4)
  [System.Runtime.InteropServices.Marshal]::FreeHGlobal($m)
  Write-Log "已设置「关闭窗口自动终止所有子进程」标志" -Level OK

  # ── 第四步：启动开发服务器（npm run dev，显式绑定 3000）──
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = "cmd.exe"
  if ($Tauri) {
    # Tauri 桌面壳：tauri CLI 会先跑 beforeDevCommand（pnpm dev）再弹桌面窗口；
    # 整棵进程树都在本 Job Object 内，关闭窗口自动全清
    $psi.Arguments = "/c pnpm tauri dev"
  } else {
    # Web 模式：显式 -p 3000，端口已在上一步清干净，保证新实例一定落在 3000
    $psi.Arguments = "/c npm run dev -- -p 3000"
  }
  $psi.WorkingDirectory = (Get-Location).Path
  $psi.UseShellExecute = $false
  $p = [System.Diagnostics.Process]::Start($psi)
  Write-Log ("开发服务器进程已启动（PID: {0}）" -f $p.Id) -Level OK

  # 把进程绑到 Job 对象
  $null = [WJ]::AssignProcessToJobObject($h, $p.Handle)
  Write-Log "进程已绑定到 Job Object（关窗口时一起清理）" -Level OK

  # ── 第五步：显示启动摘要，等待进程退出 ──
  if ($Tauri) {
    Show-Summary -Title "Comfy-APP 桌面壳（Tauri）已启动" -Lines @(
      "模式   : Tauri 桌面壳",
      "PID    : $($p.Id)",
      "地址   : http://localhost:3000",
      "停止   : 关闭桌面窗口或结束本进程（自动清理全部子进程）"
    )
  } else {
    Show-Summary -Title "Comfy-APP 开发服务器已启动" -Lines @(
      "模式   : Web 开发服务器（Next.js + Turbopack）",
      "PID    : $($p.Id)",
      "地址   : http://localhost:3000",
      "停止   : 关闭此窗口（自动清理全部子进程）"
    )
  }

  # ── 第五步（续）：等服务器 Ready 后自动打开/刷新浏览器 ──
  #   普通重启时 Next 的 HMR 会自动重载已有标签页；这里额外自动开浏览器，
  #   让你连地址都不用敲。SKIP_CLEAN=1 时复用现有标签页（Next HMR 自动重载）；
  #   默认路径会带缓存破坏参数开新标签页，避免旧 chunk + 旧 sessionStorage 残留。
  # Tauri 模式：桌面窗口由 tauri CLI 负责弹出，无需开浏览器、无需端口就绪探测
  if ($Tauri) {
    Write-Log "Tauri 模式：等待 tauri dev 编译并弹出桌面窗口..." -Level STEP
  } elseif ($env:NO_OPEN -ne "1") {
    Write-Log "等待服务器就绪（http://127.0.0.1:3000）..." -Level STEP
    $ready = $false
    for ($i = 0; $i -lt 90; $i++) {
      try {
        $r = Invoke-WebRequest -Uri "http://127.0.0.1:3000" -TimeoutSec 1 -UseBasicParsing -ErrorAction SilentlyContinue
        if ($r.StatusCode -eq 200) { $ready = $true; break }
      } catch { }
      Start-Sleep -Seconds 1
    }
    if ($ready) {
      if ($env:SKIP_CLEAN -eq "1") {
        # 用户明确跳过清理：尝试复用现有标签页（Next HMR 会自动重载）
        $url = "http://localhost:3000"
        Write-Log "服务器已就绪，复用现有标签页（Next HMR 自动重载）" -Level OK
      } else {
        # 默认路径：带缓存破坏参数开新标签页，避免旧 chunk + 旧 sessionStorage 残留
        $url = "http://localhost:3000/?__fresh=$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())"
        Write-Log "服务器已就绪，打开全新标签页（带缓存破坏参数）" -Level OK
      }
      try { Start-Process $url -ErrorAction SilentlyContinue } catch { }
    } else {
      Write-Log "90 秒内未就绪，请手动打开 http://localhost:3000" -Level WARN
    }
  }

  # 阻塞等待开发服务器退出
  $p.WaitForExit()
  Write-Log "开发服务器已退出，正在释放 Job Object..." -Level STEP
  $null = [WJ]::CloseHandle($h)
  Write-Log "全部子进程已清理，启动器正常退出" -Level OK
}
catch {
  Write-Log "启动失败：" -Level ERROR
  Write-Log $_.Exception.Message -Level ERROR
  Write-Log $_.ScriptStackTrace -Level ERROR
  Write-Log ("详情请查看日志：{0}" -f $currentLog) -Level WARN
}
finally {
  try { Stop-Transcript -ErrorAction SilentlyContinue } catch {}
  # 将本次运行完整日志追加到按日累积文件
  if (Test-Path $currentLog) {
    try {
      Add-Content -Path $dailyLog -Value (Get-Content -Raw $currentLog) -Encoding utf8 -ErrorAction SilentlyContinue
    } catch { }
  }
  $runEndMarker = "===== 运行结束 {0} =====" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss")
  Add-Content -Path $dailyLog -Value $runEndMarker -Encoding utf8 -ErrorAction SilentlyContinue
}
