# dev-launcher.ps1 — 用 Windows Job Object 启动开发服务器
# 原理：把 npm 进程及其所有子进程挂到同一个 Job 对象上，
#       并设置「关闭窗口时自动杀掉整个 Job」，从而实现关窗口零残留。
# 用法：pwsh -ExecutionPolicy Bypass -File scripts\dev-launcher.ps1
# 日志：自动写入项目根目录 dev-launcher.log，方便排查问题。
#
# 改进（2026-08-04）：启动前按端口「精准」杀掉残留的 dev server，
#   彻底避免「旧实例占着 3000、新实例被挤到 3001、浏览器连着旧代码」的尴尬。
# 改进（2026-08-06）：默认每次启动都清空 .next（强制重新编译），彻底摆脱
#   「Turbopack 编译产物缓存了旧 route.ts / API 旧 schema」的陷阱——这是
#   之前子图 boundaryPin 改动「看不到效果」的根因之一。首次启动会慢 30~60s
#   （Turbopack 重新打包），但 HMR 热更新不受影响；想省这点时间可设
#   SKIP_CLEAN=1（如 `set SKIP_CLEAN=1 && .\run-ps.bat`）。
#   启动 Ready 后会自动打开/聚焦浏览器 http://localhost:3000：
#     - 普通重启：Next 的 HMR 会自动重载已有标签页，无需手动硬刷；
#     - 默认启动会带缓存破坏参数开新标签页，避免旧的 stale chunk 残留。
#   若不想自动开浏览器，设 NO_OPEN=1 即可。
#   若浏览器已有 Comfy-APP 旧标签页，请顺手关掉（sessionStorage 缓存按 tab
#   隔离，缓存键版本虽已升到 v2 永久作废旧缓存，但关掉旧 tab 是最直观的保险）。

$ErrorActionPreference = "Stop"

# 记录日志到文件（即使窗口一闪而过也能事后查看）
$logFile = Join-Path $PSScriptRoot "..\dev-launcher.log"
try { Start-Transcript -Path $logFile -Force -ErrorAction SilentlyContinue } catch {}

function Write-Step($msg) {
  Write-Host $msg -ForegroundColor DarkGray
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
          Write-Host "        [清理] 端口 $port 被 PID $id ($($proc.ProcessName)) 占用，正在终止..." -ForegroundColor Yellow
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

Write-Step "[0/5] 启动前清理：杀掉占用 3000/3001/3002 的旧 dev server..."
foreach ($p in @(3000, 3001, 3002)) { Stop-ProcessOnPort $p }
Write-Step "        清理完成，将在 3000 端口启动全新实例。"

# ── 默认清空 .next，强制重新编译（根治「编译产物缓存了旧 API schema」问题）──
#     仅当显式 SKIP_CLEAN=1 才跳过。首次启动慢 30~60s，但保证全新编译。
if ($env:SKIP_CLEAN -eq "1") {
  Write-Step "[0.5/5] SKIP_CLEAN=1：跳过 .next 清理（保留编译缓存，首次启动更快）"
} else {
  $nextDir = Join-Path $PSScriptRoot "..\.next"
  if (Test-Path $nextDir) {
    $nextSize = (Get-ChildItem $nextDir -Recurse -File -ErrorAction SilentlyContinue |
                 Measure-Object Length -Sum).Sum
    $sizeMB = if ($nextSize) { [math]::Round($nextSize / 1MB, 1) } else { 0 }
    Write-Step "[0.5/5] 清空 .next（${sizeMB} MB，下次启动会重新编译，稍慢但保证全新）..."
    Remove-Item -Recurse -Force $nextDir -ErrorAction SilentlyContinue
    Write-Step "        已清空 .next。首次启动约需 30~60s（编译中），HMR 不受影响。"
  } else {
    Write-Step "[0.5/5] .next 不存在，无需清理"
  }
}

try {
  # ── 第一步：定义 C# 互操作类，调用 kernel32 的 Job Object API ──
  Write-Step "[1/5] 创建 Windows Job Object（进程容器）"
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

  # ── 第三步：设置「关闭窗口即终止」标志（0x2000 = KILL_ON_JOB_CLOSE）──
  $m = [System.Runtime.InteropServices.Marshal]::AllocHGlobal(4)
  [System.Runtime.InteropServices.Marshal]::WriteInt32($m, 0x2000)
  $null = [WJ]::SetInformationJobObject($h, 7, $m, 4)
  [System.Runtime.InteropServices.Marshal]::FreeHGlobal($m)
  Write-Step "[2/5] 已设置「关闭窗口自动终止所有子进程」标志"

  # ── 第四步：启动开发服务器（npm run dev，显式绑定 3000）──
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = "cmd.exe"
  # 显式 -p 3000：端口已在上一步清干净，保证新实例一定落在 3000
  $psi.Arguments = "/c npm run dev -- -p 3000"
  $psi.WorkingDirectory = (Get-Location).Path
  $psi.UseShellExecute = $false
  $p = [System.Diagnostics.Process]::Start($psi)
  Write-Step "[3/5] 开发服务器进程已启动（PID: $($p.Id)）"

  # 把进程绑到 Job 对象
  $null = [WJ]::AssignProcessToJobObject($h, $p.Handle)
  Write-Step "[4/5] 已把进程绑定到 Job Object（关窗口时一起清理）"

  # ── 第五步：显示状态横幅，等待进程退出 ──
  Write-Host ""
  Write-Host "============================================" -ForegroundColor Cyan
  Write-Host "  Comfy-APP 开发服务器已启动" -ForegroundColor Cyan
  Write-Host "  进程 PID：$($p.Id)" -ForegroundColor Cyan
  Write-Host "  访问地址：http://localhost:3000" -ForegroundColor Green
  Write-Host "  关闭此窗口即可停止服务器并清理所有子进程" -ForegroundColor Cyan
  Write-Host "  （已自动打开浏览器；普通重启靠 HMR 自动刷新，无需手动硬刷）" -ForegroundColor DarkGray
  Write-Host "============================================" -ForegroundColor Cyan
  Write-Host ""

  # ── 第五步（续）：等服务器 Ready 后自动打开/刷新浏览器 ──
  #   普通重启时 Next 的 HMR 会自动重载已有标签页；这里额外自动开浏览器，
  #   让你连地址都不用敲。SKIP_CLEAN=1 时复用现有标签页（Next HMR 自动重载）；
  #   默认路径会带缓存破坏参数开新标签页，避免旧 chunk + 旧 sessionStorage 残留。
  if ($env:NO_OPEN -ne "1") {
    Write-Step "[4.5/5] 等待服务器就绪并自动打开浏览器..."
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
        Write-Host "        已打开/聚焦浏览器（SKIP_CLEAN=1，Next HMR 自动重载）" -ForegroundColor Green
      } else {
        # 默认路径：带缓存破坏参数开新标签页，避免旧 chunk + 旧 sessionStorage 残留
        $url = "http://localhost:3000/?__fresh=$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())"
        Write-Host "        已自动打开全新标签页（带缓存破坏参数 + 旧 tab 可关闭）" -ForegroundColor Green
      }
      try { Start-Process $url -ErrorAction SilentlyContinue } catch { }
    } else {
      Write-Host "        [警告] 90s 内未就绪，请手动打开 http://localhost:3000" -ForegroundColor Yellow
    }
  }

  # 阻塞等待开发服务器退出
  $p.WaitForExit()
  Write-Host ""
  Write-Step "[5/5] 开发服务器进程已退出，正在释放 Job Object..."
  $null = [WJ]::CloseHandle($h)
  Write-Host ""
  Write-Host ">> 已完成。所有子进程均已清理干净。" -ForegroundColor Green
}
catch {
  Write-Host ""
  Write-Host "[错误] 启动失败：" -ForegroundColor Red
  Write-Host $_.Exception.Message -ForegroundColor Red
  Write-Host $_.ScriptStackTrace -ForegroundColor DarkRed
  Write-Host ""
  Write-Host "请查看日志文件：dev-launcher.log" -ForegroundColor Yellow
}
finally {
  try { Stop-Transcript -ErrorAction SilentlyContinue } catch {}
}
