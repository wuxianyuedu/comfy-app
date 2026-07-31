# dev-launcher.ps1 — 用 Windows Job Object 启动开发服务器
# 原理：把 npm 进程及其所有子进程挂到同一个 Job 对象上，
#       并设置「关闭窗口时自动杀掉整个 Job」，从而实现关窗口零残留。
# 用法：pwsh -ExecutionPolicy Bypass -File scripts\dev-launcher.ps1
# 日志：自动写入项目根目录 dev-launcher.log，方便排查问题。

$ErrorActionPreference = "Stop"

# 记录日志到文件（即使窗口一闪而过也能事后查看）
$logFile = Join-Path $PSScriptRoot "..\dev-launcher.log"
try { Start-Transcript -Path $logFile -Force -ErrorAction SilentlyContinue } catch {}

function Write-Step($msg) {
  Write-Host $msg -ForegroundColor DarkGray
}

try {
  # ── 第 0 步：检查端口 3000 是否被占用（避免 npm 启动即失败）──
  Write-Step "[0/5] 检查端口 3000 是否被占用..."
  $occupied = $false
  try {
    $tcp = New-Object System.Net.Sockets.TcpClient
    $tcp.Connect("127.0.0.1", 3000)
    $tcp.Close()
    $occupied = $true
  } catch { $occupied = $false }
  if ($occupied) {
    Write-Host "[警告] 端口 3000 已被占用！可能是上次未清理的 dev server。" -ForegroundColor Yellow
    Write-Host "        请先在任务管理器结束 node 进程，或运行：taskkill /f /im node.exe" -ForegroundColor Yellow
    Write-Host ""
  }

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

  # ── 第四步：启动开发服务器（npm run dev）──
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = "cmd.exe"
  $psi.Arguments = "/c npm run dev"
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
  Write-Host "  关闭此窗口即可停止服务器并清理所有子进程" -ForegroundColor Cyan
  Write-Host "============================================" -ForegroundColor Cyan
  Write-Host ""

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
