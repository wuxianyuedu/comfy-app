# 启动 Drizzle Studio（drizzle-kit studio）并打开可视化界面。
# 关键修复：先拉起 Studio 服务、等待端口就绪，再打开浏览器前端，
# 避免「前端界面先打开、服务还没起来」导致页面卡在
# "Connecting to the Drizzle Kit on localhost:4983"。
$ErrorActionPreference = "Stop"

$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$Port = 4983

# 若端口已被占用（Studio 已在运行），直接打开浏览器即可
try {
  $tcp = New-Object System.Net.Sockets.TcpClient
  $tcp.Connect("127.0.0.1", $Port)
  $tcp.Dispose()
  Write-Host "端口 $Port 已被占用，Drizzle Studio 可能已在运行。" -ForegroundColor Yellow
  Write-Host "正在打开 http://localhost:$Port ..." -ForegroundColor Cyan
  Start-Process "http://localhost:$Port"
  Read-Host "按 Enter 退出"
  exit 0
} catch {
  # 端口空闲，继续启动
}

Write-Host "正在启动 Drizzle Studio（端口 $Port）..." -ForegroundColor Green

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = "cmd.exe"
$psi.Arguments = "/c pnpm exec drizzle-kit studio --port $Port"
$psi.WorkingDirectory = $root
$psi.UseShellExecute = $false
$psi.CreateNoWindow = $true
$proc = [System.Diagnostics.Process]::Start($psi)
if (-not $proc) {
  Write-Host "无法启动 drizzle-kit studio，请检查 pnpm / drizzle-kit 是否可用。" -ForegroundColor Red
  Read-Host "按 Enter 退出"
  exit 1
}

# 等待端口就绪（最多 30s），确保服务真的起来了再开前端
$ready = $false
for ($i = 0; $i -lt 30; $i++) {
  try {
    $tcp = New-Object System.Net.Sockets.TcpClient
    $tcp.Connect("127.0.0.1", $Port)
    $tcp.Dispose()
    $ready = $true
    break
  } catch {
    Start-Sleep -Seconds 1
  }
}

if (-not $ready) {
  Write-Host "30 秒内端口 $Port 未就绪，Drizzle Studio 可能启动失败（检查 log/ 与终端）。" -ForegroundColor Red
  Read-Host "按 Enter 退出"
  exit 1
}

Write-Host "Drizzle Studio 已就绪，正在打开浏览器..." -ForegroundColor Green
Start-Process "http://localhost:$Port"
Write-Host "保持此窗口打开；Ctrl+C 可停止 Drizzle Studio 服务。" -ForegroundColor Gray

# 阻塞，直到服务进程退出（或用户 Ctrl+C）
try { $proc.WaitForExit() } catch { }
