#Requires -Version 5.1
<#
setup-comfy-cli-venv.ps1 — 准备 comfy-cli 的 Python 虚拟环境
===============================================================================
原先由启动器在每次启动时后台触发；启动器已随 ISSUE #784 移除，现按需手工执行。

背景：raw UI-format（liblib 子图）工作流需要交给 comfy-cli 做 UI→API 转换，
executor-cli.ts 固定使用 <项目根>/python-venv/comfy-cli 下的 Python 解释器。
该 venv 不存在时 spawn 会直接 ENOENT，用户只看到一串 spawn 报错，无从下手。
本脚本把「建 venv → 升 pip → 装 comfy-cli」固化下来，首次启动自动完成。

幂等：venv 已存在且 comfy_cli 可导入时不重装；已就绪的 venv 走「版本检查 →
需要则升级」，默认每 24h 才联网查一次最新版（避免每次启动都打扰 PyPI），
-Force 可跳过节流立即检查。拿不到最新版本信息（离线 / PyPI 不可达）或升级
失败都只记日志并保持已安装版本——venv 仍可用，不阻断启动。

产物：
  日志   log/tools/comfy-cli-setup.log
  状态   run/comfy-cli-setup.json   （{ phase, message, done, error, updated_at }）
  节流   run/comfy-cli-upgrade-check.json （{ last_check_at, installed, latest }）
#>
param(
  # 跳过 24h 节流，立即检查并升级（手工执行时用）
  [switch]$Force
)

$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$LogDir      = Join-Path $ProjectRoot "log\tools"
$RunDir      = Join-Path $ProjectRoot "run"
$LogFile     = Join-Path $LogDir "comfy-cli-setup.log"
$StatusFile  = Join-Path $RunDir "comfy-cli-setup.json"
$VenvDir     = Join-Path $ProjectRoot "python-venv\comfy-cli"
$VenvPy      = Join-Path $VenvDir "Scripts\python.exe"
$UpgradeStateFile = Join-Path $RunDir "comfy-cli-upgrade-check.json"

# 最新版检查的最小间隔（小时）：启动是高频动作，没必要每次都联网问 PyPI
$UpgradeCheckIntervalHours = 24

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
function Invoke-Process {
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

  $ok = $true
  if ($proc.ExitCode -ne 0) {
    Write-Log "ERROR" "$Label 失败（exit=$($proc.ExitCode)）"
    $ok = $false
  } else {
    Write-Log "OK" "$Label 完成"
  }
  return [pscustomobject]@{
    Ok       = $ok
    ExitCode = $proc.ExitCode
    StdOut   = $outText
    StdErr   = $errText
  }
}

function Invoke-Step {
  param(
    [string]$Label,
    [string]$FilePath,
    [string[]]$Arguments,
    [int]$TimeoutSec = 900
  )

  return (Invoke-Process -Label $Label -FilePath $FilePath -Arguments $Arguments -TimeoutSec $TimeoutSec).Ok
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

# ── 版本查询 ─────────────────────────────────────────────────────────────────
function Get-InstalledComfyCliVersion {
  $r = Invoke-Process -Label "读取已安装的 comfy-cli 版本" -FilePath $VenvPy `
    -Arguments @("-m", "pip", "show", "comfy-cli") -TimeoutSec 120
  if (-not $r.Ok) { return $null }
  foreach ($line in ($r.StdOut -split "`r?`n")) {
    if ($line -match '^Version:\s*(\S+)') { return $Matches[1] }
  }
  return $null
}

function Get-LatestComfyCliVersion {
  $r = Invoke-Process -Label "查询 comfy-cli 最新版本" -FilePath $VenvPy `
    -Arguments @("-m", "pip", "index", "versions", "comfy-cli") -TimeoutSec 180
  if (-not $r.Ok) {
    # 离线 / PyPI 不可达是常态而非故障：保持已安装版本，不阻断启动
    Write-Log "WARN" "查询 comfy-cli 最新版本失败，跳过升级检查（离线或 PyPI 不可达）"
    return $null
  }
  foreach ($line in ($r.StdOut -split "`r?`n")) {
    if ($line -match '^comfy-cli\s*\(([^)]+)\)') { return $Matches[1] }
  }
  return $null
}

function Compare-Version {
  param([string]$Left, [string]$Right)
  try {
    $l = [version]$Left
    $r = [version]$Right
    if ($l -lt $r) { return -1 }
    if ($l -eq $r) { return 0 }
    return 1
  } catch {
    return [string]::CompareOrdinal($Left, $Right)
  }
}

# ── 升级检查节流（避免每次启动都联网问 PyPI）────────────────────────────────
function Read-UpgradeState {
  if (-not (Test-Path $UpgradeStateFile)) { return $null }
  try {
    return (Get-Content -LiteralPath $UpgradeStateFile -Raw -Encoding UTF8 | ConvertFrom-Json)
  } catch {
    return $null
  }
}

function Save-UpgradeState {
  param([string]$Installed, [string]$Latest)
  try {
    if (-not (Test-Path $RunDir)) {
      New-Item -ItemType Directory -Path $RunDir -Force | Out-Null
    }
    $payload = @{
      last_check_at = (Get-Date -Format "o")
      installed     = $Installed
      latest        = $Latest
    } | ConvertTo-Json -Compress
    [System.IO.File]::WriteAllText(
      $UpgradeStateFile,
      $payload,
      [System.Text.UTF8Encoding]::new($false)
    )
  } catch {
    # 节流状态写失败不影响主流程
  }
}

function Test-UpgradeCheckDue {
  if ($Force) { return $true }
  $state = Read-UpgradeState
  if (-not $state -or -not $state.last_check_at) { return $true }
  try {
    $last = [datetime]::Parse($state.last_check_at)
    return (((Get-Date) - $last).TotalHours -ge $UpgradeCheckIntervalHours)
  } catch {
    return $true
  }
}

# ── 主流程 ───────────────────────────────────────────────────────────────────
Write-Log "INFO" "=== comfy-cli 环境检查开始 ==="

if ((Test-Path $VenvPy) -and (Test-ComfyCliInstalled)) {
  $installed = Get-InstalledComfyCliVersion
  Write-Log "INFO" "comfy-cli 环境已就绪：$VenvPy（v$installed）"

  if (-not (Test-UpgradeCheckDue)) {
    Write-Log "OK" "距上次升级检查不足 ${UpgradeCheckIntervalHours}h，跳过（立即检查：加 -Force）"
    Write-Status -Phase "done" -Message "comfy-cli 环境已就绪（v$installed）" -Done $true
    exit 0
  }

  $latest = Get-LatestComfyCliVersion
  if (-not $latest) {
    Write-Log "WARN" "未取到最新版本，保持已安装版本 $installed"
    Write-Status -Phase "done" -Message "comfy-cli 环境已就绪（v$installed）" -Done $true
    exit 0
  }

  if ((Compare-Version -Left $installed -Right $latest) -ge 0) {
    Write-Log "OK" "comfy-cli 已是最新版（$installed）"
    Save-UpgradeState -Installed $installed -Latest $latest
    Write-Status -Phase "done" -Message "comfy-cli 环境已就绪（v$installed）" -Done $true
    exit 0
  }

  Write-Log "WARN" "comfy-cli 有新版本：$installed → $latest，开始升级"
  Write-Status -Phase "upgrade" -Message "正在升级 comfy-cli（$installed → $latest）…"

  if (Invoke-Step -Label "升级 comfy-cli" -FilePath $VenvPy `
      -Arguments @("-m", "pip", "install", "--upgrade", "comfy-cli") -TimeoutSec 1800) {
    $after = Get-InstalledComfyCliVersion
    Write-Log "OK" "comfy-cli 升级完成：$installed → $after"
    Save-UpgradeState -Installed $after -Latest $latest
    Write-Status -Phase "done" -Message "comfy-cli 已升级至 v$after" -Done $true
    exit 0
  }

  # 升级失败不阻断：venv 仍在，旧版本可继续工作，下次启动再试
  Write-Log "ERROR" "comfy-cli 升级失败，继续使用已安装版本 $installed"
  Save-UpgradeState -Installed $installed -Latest $latest
  Write-Status -Phase "done" -Message "comfy-cli 升级失败，继续使用 v$installed（详见日志）" -Done $true
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
    Write-Status -Phase "error" -Message "创建虚拟环境失败，详见 log/tools/comfy-cli-setup.log" -Failed $true
    exit 1
  }
}

Write-Status -Phase "pip" -Message "正在安装 comfy-cli（首次较慢）…"

if (-not (Invoke-Step -Label "升级 pip" -FilePath $VenvPy -Arguments @("-m", "pip", "install", "--upgrade", "pip") -TimeoutSec 600)) {
  Write-Status -Phase "error" -Message "升级 pip 失败，详见 log/tools/comfy-cli-setup.log" -Failed $true
  exit 1
}

if (-not (Invoke-Step -Label "安装 comfy-cli" -FilePath $VenvPy -Arguments @("-m", "pip", "install", "comfy-cli") -TimeoutSec 1800)) {
  Write-Status -Phase "error" -Message "安装 comfy-cli 失败，详见 log/tools/comfy-cli-setup.log" -Failed $true
  exit 1
}

# 刚装上的就是最新版，记录一次检查时间，避免下次启动立刻再查一遍
Save-UpgradeState -Installed (Get-InstalledComfyCliVersion) -Latest ""

Write-Log "OK" "comfy-cli 环境已就绪：$VenvPy"
Write-Status -Phase "done" -Message "comfy-cli 环境已就绪" -Done $true
exit 0
