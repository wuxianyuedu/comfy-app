#Requires -Version 5.1
<#
setup-comfy-cli-venv.ps1 — 准备 comfy-cli 的 Python 虚拟环境
===============================================================================
由 start-tauri.exe（scripts/start_tauri_launcher.py）在启动时后台触发。

背景：raw UI-format（liblib 子图）工作流需要交给 comfy-cli 做 UI→API 转换，
executor-cli.ts 固定使用 <项目根>/python-venv/comfy-cli 下的 Python 解释器。
该 venv 不存在时 spawn 会直接 ENOENT，用户只看到一串 spawn 报错，无从下手。
本脚本把「建 venv → 升 pip → 装 comfy-cli」固化下来，首次启动自动完成。

幂等：venv 已存在且 comfy_cli 可导入时直接返回，不重复安装。

产物：
  日志   log/comfy-cli-setup.log
  状态   run/comfy-cli-setup.json   （{ phase, message, done, error, updated_at }）
#>
param()

$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$LogDir      = Join-Path $ProjectRoot "log"
$RunDir      = Join-Path $ProjectRoot "run"
$LogFile     = Join-Path $LogDir "comfy-cli-setup.log"
$StatusFile  = Join-Path $RunDir "comfy-cli-setup.json"
$VenvDir     = Join-Path $ProjectRoot "python-venv\comfy-cli"
$VenvPy      = Join-Path $VenvDir "Scripts\python.exe"

# ── 日志 / 状态 ──────────────────────────────────────────────────────────────
function Write-Log {
  param([string]$Level, [string]$Message)
  $ts = Get-Date -Format "HH:mm:ss"
  $line = "[$ts] [$Level] $Message"
  try {
    if (-not (Test-Path $LogDir)) {
      New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
    }
    Add-Content -Path $LogFile -Value $line -Encoding UTF8
  } catch {
    # 日志写入失败不影响主流程
  }
}

function Write-Status {
  param(
    [string]$Phase,
    [string]$Message,
    [bool]$Done = $false,
    [bool]$Failed = $false
  )
  try {
    if (-not (Test-Path $RunDir)) {
      New-Item -ItemType Directory -Path $RunDir -Force | Out-Null
    }
    $payload = @{
      phase      = $Phase
      message    = $Message
      done       = $Done
      error      = $Failed
      updated_at = (Get-Date -Format "o")
    } | ConvertTo-Json -Compress
    [System.IO.File]::WriteAllText(
      $StatusFile,
      $payload,
      [System.Text.UTF8Encoding]::new($false)
    )
  } catch {
    # 状态写入失败不影响主流程
  }
}

# ── 子进程执行（异步读取输出，避免 RedirectStandardOutput 缓冲区死锁）────────
function Invoke-Step {
  param(
    [string]$Label,
    [string]$FilePath,
    [string[]]$Arguments,
    [int]$TimeoutSec = 900
  )

  Write-Log "STEP" $Label
  Write-Log "INFO" "> $FilePath $($Arguments -join ' ')"

  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName               = $FilePath
  $psi.Arguments              = ($Arguments | ForEach-Object { '"' + $_ + '"' }) -join ' '
  $psi.UseShellExecute        = $false
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError  = $true
  $psi.CreateNoWindow         = $true
  $psi.WorkingDirectory       = $ProjectRoot

  $proc = [System.Diagnostics.Process]::Start($psi)
  # 先挂上异步读，再 WaitForExit：同步 ReadToEnd 在输出撑满缓冲区时会死锁
  $stdout = $proc.StandardOutput.ReadToEndAsync()
  $stderr = $proc.StandardError.ReadToEndAsync()

  if (-not $proc.WaitForExit($TimeoutSec * 1000)) {
    try { $proc.Kill() } catch { }
    Write-Log "ERROR" "$Label 超时（${TimeoutSec}s）"
    return $false
  }

  $outText = $stdout.GetAwaiter().GetResult()
  $errText = $stderr.GetAwaiter().GetResult()
  if ($outText) { Write-Log "INFO" ($outText.Trim()) }
  if ($errText) { Write-Log "WARN" ($errText.Trim()) }

  if ($proc.ExitCode -ne 0) {
    Write-Log "ERROR" "$Label 失败（exit=$($proc.ExitCode)）"
    return $false
  }
  Write-Log "OK" "$Label 完成"
  return $true
}

# ── 检测 comfy_cli 是否可用 ──────────────────────────────────────────────────
function Test-ComfyCliInstalled {
  if (-not (Test-Path $VenvPy)) { return $false }
  try {
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName               = $VenvPy
    $psi.Arguments              = '-c "import comfy_cli"'
    $psi.UseShellExecute        = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError  = $true
    $psi.CreateNoWindow         = $true
    $psi.WorkingDirectory       = $ProjectRoot
    $proc = [System.Diagnostics.Process]::Start($psi)
    [void]$proc.StandardOutput.ReadToEndAsync()
    [void]$proc.StandardError.ReadToEndAsync()
    if (-not $proc.WaitForExit(120000)) {
      try { $proc.Kill() } catch { }
      return $false
    }
    return ($proc.ExitCode -eq 0)
  } catch {
    return $false
  }
}

# ── 主流程 ───────────────────────────────────────────────────────────────────
Write-Log "INFO" "=== comfy-cli 环境检查开始 ==="

if ((Test-Path $VenvPy) -and (Test-ComfyCliInstalled)) {
  Write-Log "OK" "comfy-cli 环境已就绪：$VenvPy"
  Write-Status -Phase "done" -Message "comfy-cli 环境已就绪" -Done $true
  exit 0
}

if (-not (Test-Path $VenvPy)) {
  Write-Log "WARN" "未找到虚拟环境，准备创建：$VenvPy"
  Write-Status -Phase "venv" -Message "正在创建 comfy-cli 虚拟环境…"

  $basePy = $null
  foreach ($cmd in @("python", "python3", "py")) {
    $found = Get-Command $cmd -ErrorAction SilentlyContinue
    if ($found) { $basePy = $found.Source; break }
  }
  if (-not $basePy) {
    Write-Log "ERROR" "未找到 Python，无法创建虚拟环境"
    Write-Status -Phase "error" -Message "未找到 Python，请先安装 Python 3.10+" -Failed $true
    exit 1
  }
  Write-Log "INFO" "使用基础 Python：$basePy"

  # py.exe 启动器需要显式 -3 才会选 Python 3
  $venvArgs = @("-m", "venv", $VenvDir)
  if ((Split-Path $basePy -Leaf).ToLower() -eq "py.exe") {
    $venvArgs = @("-3", "-m", "venv", $VenvDir)
  }

  if (-not (Invoke-Step -Label "创建虚拟环境" -FilePath $basePy -Arguments $venvArgs -TimeoutSec 300)) {
    Write-Status -Phase "error" -Message "创建虚拟环境失败，详见 log/comfy-cli-setup.log" -Failed $true
    exit 1
  }
}

Write-Status -Phase "pip" -Message "正在安装 comfy-cli（首次较慢）…"

if (-not (Invoke-Step -Label "升级 pip" -FilePath $VenvPy -Arguments @("-m", "pip", "install", "--upgrade", "pip") -TimeoutSec 600)) {
  Write-Status -Phase "error" -Message "升级 pip 失败，详见 log/comfy-cli-setup.log" -Failed $true
  exit 1
}

if (-not (Invoke-Step -Label "安装 comfy-cli" -FilePath $VenvPy -Arguments @("-m", "pip", "install", "comfy-cli") -TimeoutSec 1800)) {
  Write-Status -Phase "error" -Message "安装 comfy-cli 失败，详见 log/comfy-cli-setup.log" -Failed $true
  exit 1
}

Write-Log "OK" "comfy-cli 环境已就绪：$VenvPy"
Write-Status -Phase "done" -Message "comfy-cli 环境已就绪" -Done $true
exit 0
