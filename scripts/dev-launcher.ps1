# dev-launcher.ps1 — 用 pnpm 拉起 dev server / Tauri 壳，并以进程树回收做唯一编排者
# 原理：通过 pnpm 启动子进程，清理时用 `taskkill /PID <pid> /T /F` 杀整棵进程树
#       （docs/standards/launch-and-build.md §3）。Job Object 的 KILL_ON_JOB_CLOSE 在本机
#       设置失败（Win32 错误 87），仅 WARN 兜底、不依赖其生效。
# 用法：pwsh -ExecutionPolicy Bypass -File scripts\dev-launcher.ps1 [-Tauri]
# 日志：
#   - 本次运行日志：log/dev-launcher.log（每次运行覆盖，供应用内面板实时读取）
#   - 历史运行日志：log/YYYY-MM/dev-launcher-YYYY-MM-DD_HH-mm-ss.log（每次运行结束归档）
#
# 改进（2026-09-04）：启动前做 .env 前置检查——缺 .env 时 pnpm dev 会因
#   src/env.js 校验 DATABASE_URL / BETTER_AUTH_* 未定义而报一堆 "Invalid
#   environment variables"，用户看不出是「缺文件」。现改为启动即给出清晰提示，
#   引导先跑 tools/start/run-local.ps1（对应 AGENTS.md 硬规则 4）。
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
#   3) 日志目录改为项目根目录 log/，历史日志按年月分子目录并以日期+
#      时分秒命名，便于检索与归档；同时保留 dev-launcher.log 作为当前
#      运行文件供应用内日志面板实时读取。
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
  [switch]$Tauri,    # 传 -Tauri 时启动 Tauri 桌面壳（pnpm tauri dev），完整 Rust 热重载但启动慢
  [switch]$Prebuilt  # 传 -Prebuilt 时直接启动预编译的 Tauri 壳（窗口秒出），后台再启动 next dev
)

$ErrorActionPreference = "Stop"

# 以 CI 模式运行 pnpm，避免它在隐藏窗口里弹出「是否重新安装 node_modules」
# 等交互式提示，导致 dev server 进程卡死、健康检查一直超时。
$env:CI = "true"

# 让 Write-Host 的 ANSI 转义序列原样写进 Transcript（应用内日志面板用 ANSI
# 解析器还原颜色）。默认 Host 模式会在写非终端目标时剥离颜色，所以这里强制
# 输出 Ansi。仅 PowerShell 7 (pwsh) 支持 $PSStyle。
if (Get-Variable -Name PSStyle -ErrorAction SilentlyContinue) {
  $PSStyle.OutputRendering = "Ansi"
}

# ── 日志目录与文件 ──
$logDir = Join-Path $PSScriptRoot "..\log"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }

# 按年月分子目录，每次运行一个带时分秒的历史日志文件
$now = Get-Date
$yearMonth = $now.ToString("yyyy-MM")
$monthDir = Join-Path $logDir $yearMonth
if (-not (Test-Path $monthDir)) { New-Item -ItemType Directory -Path $monthDir -Force | Out-Null }

$runTimestamp = $now.ToString("yyyy-MM-dd_HH-mm-ss")
$runLog = Join-Path $monthDir ("dev-launcher-" + $runTimestamp + ".log")
$currentLog = Join-Path $logDir "dev-launcher.log"

# 本次运行日志：覆盖清空，作为实时读取源
# 若旧实例崩溃未退出，Start-Transcript 仍持有 dev-launcher.log 句柄，会导致
# Set-Content 报「文件被占用」。这里先尝试重命名旧日志，再创建新文件。
function Clear-CurrentLog {
  param([string]$Path)
  # 上一次运行的启动器在窗口关闭后可能有数秒清理期，期间仍持有本日志的
  # Transcript 句柄导致「文件被占用」。先短暂重试等它退干净，再走兜底。
  for ($attempt = 0; $attempt -lt 6; $attempt++) {
    try {
      Set-Content -Path $Path -Value "" -Encoding utf8 -Force -ErrorAction Stop
      return $Path
    } catch {
      if ($attempt -lt 5) { Start-Sleep -Milliseconds 500 }
    }
  }
  $backup = $Path -replace '\.log$', "-locked-$($now.ToString('yyyyMMdd_HHmmss')).log"
  try {
    Move-Item -Path $Path -Destination $backup -Force -ErrorAction Stop
    Set-Content -Path $Path -Value "" -Encoding utf8 -Force -ErrorAction Stop
    return $Path
  } catch {
    # 重命名也失败：回退到唯一文件名，避免永远起不来。
    # 注意 $PID 是 PowerShell 自动变量，不能写成 $(PID)（会被当成命令而抛错，
    # 且此处已在 catch 内，异常会直接终止整个脚本——2026-09-02 双击无窗口的根因）。
    $fallback = $Path -replace '\.log$', "-$PID.log"
    Set-Content -Path $fallback -Value "" -Encoding utf8 -Force -ErrorAction Stop
    return $fallback
  }
}
$currentLog = Clear-CurrentLog -Path $currentLog
# 让 Python 启动器和应用内日志面板能实时定位到本次运行的实际日志文件
Set-Content -Path (Join-Path $logDir "dev-launcher-current.txt") -Value $currentLog -Encoding utf8 -Force

# 历史运行文件：写入开始标记
$runStartMarker = "===== 运行开始 {0} =====" -f ($now.ToString("yyyy-MM-dd HH:mm:ss"))
Set-Content -Path $runLog -Value $runStartMarker -Encoding utf8 -Force

# 开启 Transcript，把控制台所有输出（含子进程）同步写入本次运行日志
Start-Transcript -Path $currentLog -Force -ErrorAction SilentlyContinue | Out-Null

# ── 日志输出：统一 [时间] [级别] 格式，颜色分级 ──
#   级别：STEP（步骤进度/青）、OK（成功/绿）、WARN（警告/黄）、ERROR（错误/红）、INFO（详情/灰）
#   颜色用 ANSI 转义序列直接写进输出流（而非 -ForegroundColor），这样
#   Start-Transcript 会把颜色码也记录到 log/dev-launcher.log，应用内面板用
#   ANSI 解析器原样还原多色日志。
#
#   2026-09-02 修复：PowerShell Start-Transcript 会缓冲输出、仅在 Stop-Transcript
#   （脚本退出时）才 flush 到磁盘，导致运行期间查看 dev-launcher.log 几乎为空。
#   现在采用双写策略：Write-Host（供 Transcript + 终端显示）+ 直接 Append 到文件
#   （实时落盘，应用内日志面板可立即读取）。
function Write-Log {
  param(
    [Parameter(Mandatory = $true)][string]$Message,
    [ValidateSet("STEP", "OK", "WARN", "ERROR", "INFO")][string]$Level = "INFO"
  )
  $e = [char]27
  $c = @{ STEP = "$e[36m"; OK = "$e[32m"; WARN = "$e[33m"; ERROR = "$e[31m"; INFO = "$e[90m" }[$Level]
  $ts = Get-Date -Format "HH:mm:ss"
  $lvl = ($Level).PadRight(5)
  $plainLine = "[$ts] [$lvl] $Message"
  $line = "$e[90m[$ts]$e[0m ${c}[$lvl]$e[0m $Message$e[0m"
  Write-Host $line
  # 直接追加到当前日志文件——绕过 Transcript 缓冲，确保实时可读
  try { Add-Content -LiteralPath $currentLog -Value $plainLine -Encoding utf8 -ErrorAction SilentlyContinue } catch {}
}

# ── 启动摘要卡片：标题 + 键值信息，分隔线包裹 ──
function Show-Summary {
  param(
    [Parameter(Mandatory = $true)][string]$Title,
    [Parameter(Mandatory = $true)][string[]]$Lines
  )
  $e = [char]27
  $rule = "$e[36m" + ("─" * 64) + "$e[0m"
  $cyan = "$e[36m"; $white = "$e[37m"; $reset = "$e[0m"
  Write-Host ""
  Write-Host $rule
  Write-Host "$cyan  $Title$reset"
  Write-Host $rule
  foreach ($line in $Lines) { Write-Host "$white  $line$reset" }
  Write-Host $rule
  Write-Host ""
}

# ── 读取子进程输出文件的最后 N 行（失败诊断用）──
# 注意：Get-Content 的 -Raw 与 -Tail 不能同时使用（此前同时传参抛错，导致
# 「Next.js 提前退出」时错误详情被吞、只显示空白）。
function Get-OutputTail {
  param([string]$Path, [int]$Lines = 30)
  try {
    if ($Path -and (Test-Path -LiteralPath $Path)) {
      return ((Get-Content -LiteralPath $Path -Tail $Lines -ErrorAction Stop) -join "`n")
    }
  } catch { }
  return ""
}

# ── 启动状态文件（run/launch-status.json，供 Tauri 内嵌启动页读取）──
# 由 dev-launcher 直接写入（python 启动器还有一套 tail dev-launcher.log 的旧方案，
# 但冻结在 start-tauri.exe 里的旧版会把「启动页窗口一出现」误判为就绪而提前退出，
# 30s 后还会删除状态文件——启动页从此只能显示假进度。因此 Prebuilt 模式的真实
# 进度由本脚本每秒刷新接管：从壳启动一直写到服务就绪，失败时写 error 态。
# JSON 用 UTF-8 无 BOM（启动页 JSON.parse 遇 BOM 会失败），非 ASCII 字符由
# ConvertTo-Json 转成 \uXXXX 转义。
$script:LaunchStart = $null
$script:ShellStaleMsg = $null

function Write-LaunchStatus {
  param(
    [string]$Phase,
    [double]$Progress,
    [string]$Message,
    [switch]$IsError
  )
  try {
    if ($null -eq $script:LaunchStart) { $script:LaunchStart = Get-Date }
    $elapsed = [math]::Round(((Get-Date) - $script:LaunchStart).TotalSeconds, 1)
    $payload = [ordered]@{
      phase      = $Phase
      progress   = [math]::Round($Progress, 3)
      message    = $Message
      elapsed    = $elapsed
      ready      = $false
      error      = [bool]$IsError
      app_url    = "http://127.0.0.1:3000/workspace"
      stale_shell = $script:ShellStaleMsg
      updated_at = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ss")
    }
    $dir = Join-Path $PSScriptRoot "..\run"
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    $path = Join-Path $dir "launch-status.json"
    [System.IO.File]::WriteAllText($path, ($payload | ConvertTo-Json -Compress))
  } catch { }
}

# ── 确保 Tauri 内置启动页资源存在 ──
# splash.html 由 tauri.conf.json 的 build.frontendDist（src-tauri/splash-assets/）
# 在编译期嵌入 app.exe；运行时把最新版本同步到该目录，保证下次 cargo build
# 嵌入的是当前版本。预编译壳的资源来自编译期嵌入，运行时同步不影响本次运行。
function Ensure-SplashResource {
  $staticDir = Join-Path $root "src-tauri\splash-assets"
  $splashSrc = Join-Path $root "public\splash.html"
  $splashDest = Join-Path $staticDir "splash.html"
  if (-not (Test-Path $staticDir)) {
    New-Item -ItemType Directory -Path $staticDir -Force | Out-Null
  }
  if (Test-Path $splashSrc) {
    Copy-Item -Path $splashSrc -Destination $splashDest -Force
    Write-Log "已同步 splash.html → src-tauri/splash-assets/splash.html（frontendDist，编译期嵌入）" -Level INFO
  } else {
    Write-Log "未找到 public/splash.html，Tauri 启动页可能无法显示" -Level WARN
  }
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
    # 等端口真正释放，避免 next 启动时又抢到 3001（缩短到 200ms，降低启动等待）
    Start-Sleep -Milliseconds 200
  } catch { }
}

function Reset-DevPorts {
  Write-Log "检查端口占用（3000/3001/3002）..." -Level STEP
  foreach ($port in @(3000, 3001, 3002)) { Stop-ProcessOnPort $port }
  Write-Log "端口已就绪，将启动全新实例于 3000" -Level OK
}

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
  # [SHA256]::ComputeHash 是 .NET 5+/PowerShell 7 才加入的静态方法；Windows PowerShell
  # 5.1（tools/start/start-tauri.ps1 在找不到 pwsh 7 时的回退路径）下 SHA256 只是抽象基类，调用静态
  # 方法会报 "does not contain a method named 'ComputeHash'"，导致 Get-ConfigFingerprint
  # 抛错、整个启动失败。这里统一改用 Create() 取实例再算哈希，PS 5.1 / PS 7 都能跑。
  $sha256 = [System.Security.Cryptography.SHA256]::Create()
  $files = @{}
  foreach ($rel in $targets) {
    $full = Join-Path $root $rel
    if (-not (Test-Path $full)) { continue }
    $ih.AppendData([System.Text.Encoding]::UTF8.GetBytes($rel + "`0"))
    if ((Get-Item $full).PSIsContainer) {
      $items = @(Get-ChildItem $full -Recurse -File -ErrorAction SilentlyContinue |
                 Sort-Object FullName)
      foreach ($f in $items) {
        $relPath = $f.FullName.Substring($root.Length).TrimStart('\')
        $ih.AppendData([System.Text.Encoding]::UTF8.GetBytes($relPath + "`0"))
        $bytes = [System.IO.File]::ReadAllBytes($f.FullName)
        $ih.AppendData($bytes)
        $files[$relPath] = [System.BitConverter]::ToString($sha256.ComputeHash($bytes)).Replace("-", "").ToLowerInvariant()
      }
    } else {
      $bytes = [System.IO.File]::ReadAllBytes($full)
      $ih.AppendData($bytes)
      $files[$rel] = [System.BitConverter]::ToString($sha256.ComputeHash($bytes)).Replace("-", "").ToLowerInvariant()
    }
  }
  $hash = [System.BitConverter]::ToString($ih.GetHashAndReset()).Replace("-", "").ToLowerInvariant()
  $sha256.Dispose()
  $ih.Dispose()
  # 返回组合指纹 + 逐文件指纹映射，供 Sync-NextCache 比对「具体哪些文件变了」
  return @{ Hash = $hash; Files = $files }
}

function Sync-NextCache {
  $nextDir = Join-Path $PSScriptRoot "..\.next"
  $fp = Get-ConfigFingerprint
  $fingerprint = $fp.Hash
  $fingerprintFile = Join-Path $nextDir "config-fingerprint"
  $fingerprintFilesFile = Join-Path $nextDir "config-fingerprint-files.json"

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
    Set-Content -Path $fingerprintFilesFile -Value ($fp.Files | ConvertTo-Json -Compress) -Encoding utf8
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
      # 比对具体哪些文件内容变化，便于排查「为何触发全量重编译」
      $changed = @()
      $savedFiles = @{}
      if (Test-Path $fingerprintFilesFile) {
        try {
          $raw = Get-Content $fingerprintFilesFile -Raw -ErrorAction SilentlyContinue
          if ($raw) {
            $savedObj = $raw | ConvertFrom-Json -ErrorAction SilentlyContinue
            if ($savedObj) { $savedObj.PSObject.Properties | ForEach-Object { $savedFiles[$_.Name] = $_.Value } }
          }
        } catch { }
      }
      if ($savedFiles.Count -gt 0) {
        foreach ($rel in $fp.Files.Keys) {
          if (-not $savedFiles.ContainsKey($rel) -or $savedFiles[$rel] -ne $fp.Files[$rel]) { $changed += $rel }
        }
        foreach ($rel in $savedFiles.Keys) {
          if (-not $fp.Files.ContainsKey($rel)) { $changed += "$rel (已删除)" }
        }
      } else {
        # 旧版无逐文件明细（首次升级），笼统列出全部指纹目标
        $changed = @($fp.Files.Keys)
      }
      $changedList = ($changed | ForEach-Object { "    • $_" }) -join "`n"
      Write-Log ("配置指纹变化（旧 {0} → 新 {1}），以下 {2} 个文件内容变更，清空 .next（{3} MB）全量重编译：`n{4}" -f $saved, $fingerprint, $changed.Count, $sizeMB, $changedList) -Level STEP
      Remove-Item -Recurse -Force $nextDir -ErrorAction SilentlyContinue
      New-Item -ItemType Directory -Path $nextDir -Force | Out-Null
      Set-Content -Path $fingerprintFile -Value $fingerprint -Encoding utf8
      Set-Content -Path $fingerprintFilesFile -Value ($fp.Files | ConvertTo-Json -Compress) -Encoding utf8
      Write-Log "已清空 .next 并写入新配置指纹" -Level OK
    }
  } else {
    New-Item -ItemType Directory -Path $nextDir -Force | Out-Null
    Set-Content -Path $fingerprintFile -Value $fingerprint -Encoding utf8
    Set-Content -Path $fingerprintFilesFile -Value ($fp.Files | ConvertTo-Json -Compress) -Encoding utf8
    Write-Log ("首次启动：写入初始配置指纹（{0}），执行全量编译" -f $fingerprint) -Level STEP
  }
}

# ── 预检 0.4：工具链门禁（Tauri 壳弹出前）──
# 双击 start-tauri.exe 时，python 启动器会在 Tauri 主窗口出现前持续监控
# dev-launcher 是否提前退出，一旦提前退出就弹 MessageBox（人类可见出口）。
# 因此在拉起预编译壳「之前」先做一次只读门禁：若 pnpm 工具链已经坏到连命令
# 都跑不起来（corepack 切换缓存损坏等），此时弹壳也起不来服务，应立刻 throw
# 让启动器弹窗告知根因与修复步骤，而不是先弹出黑窗口再在 splash 里慢慢报错。
# 注意：此处只做「致命快检」，不做 install 自愈/版本对齐（那是窗口出现后
# Test-PnpmVersion / Test-DevDependencies 的职责，避免门禁拖慢健康环境的秒出）。
function Test-ToolchainGate {
  # 1) pnpm 命令可用性：corepack shim 存在但切换版本缓存损坏（.tools\pnpm\<ver>\bin
  #    缺失）时，pnpm -v 会报 "Failed to switch pnpm to ... ENOENT"，命令不可用。
  #    这是最致命的环境损坏——install / dev 全依赖它。
  $pnpmCmd = Get-Command pnpm -ErrorAction SilentlyContinue
  if (-not $pnpmCmd) {
    Write-Log "工具链门禁：未找到 pnpm 命令（需 corepack enable）" -Level ERROR
    throw "未找到 pnpm 命令：请先执行 corepack enable（或运行 tools\start\run-local.ps1）后重启应用。"
  }
  $probeErr = ""
  try {
    $probe = & pnpm -v 2>&1
    $probeExit = $LASTEXITCODE
    $probeLines = @($probe | ForEach-Object { $_.ToString() })
    if ($probeExit -ne 0 -or -not ($probeLines | Where-Object { $_ -match '[0-9]+\.[0-9]+' })) {
      $probeErr = (($probeLines | Where-Object {
        $_ -match "Failed to switch|ENOENT|not found|无法|不是内部或外部|ERR_|No such file"
      } | Select-Object -First 3) -join " ").Trim()
      if (-not $probeErr) { $probeErr = ($probeLines -join " ").Trim() }
    }
  } catch {
    $probeErr = "调用 pnpm 抛异常：$($_.Exception.Message)"
  }
  if ($probeErr) {
    $fatal = "pnpm 工具链损坏：pnpm 命令无法运行"
    if ($probeErr) { $fatal += "`n  原始报错：$probeErr" }
    $fatal += "`n疑似 corepack 切换版本时本地缓存损坏（.tools\pnpm\<ver>\bin 缺失）。"
    $fatal += "`n修复：corepack enable && corepack prepare pnpm@<project版本> --activate，再重启应用。"
    Write-Log $fatal -Level ERROR
    throw $fatal
  }
  Write-Log "工具链门禁：pnpm 命令可用" -Level OK

  # 2) node_modules 是否「完全未安装」：连 .modules.yaml 都不存在 = 依赖从没装好，
  #    弹壳后 dev server 必然起不来。此处不自动 install（避免门禁阻塞），直接引导。
  if (-not (Test-Path -LiteralPath (Join-Path $root "node_modules\.modules.yaml"))) {
    $fatal = "node_modules 缺失或不完整（找不到 node_modules\.modules.yaml）：依赖尚未正确安装。"
    $fatal += "`n请运行 tools\start\run-local.ps1（或 scripts\prepare-local-run.ps1）完成依赖安装后再启动。"
    Write-Log $fatal -Level ERROR
    throw $fatal
  }
}

# ── 预检 0.5：pnpm 版本一致性检查 ──
# package.json 的 packageManager 字段声明了本项目所需的 pnpm 版本（如
# pnpm@11.25.0）。若本机 pnpm 版本不匹配（常见于拉取代码后团队升级了 pnpm
# 版本，或本机直接安装的全局 pnpm 而非 corepack 管理），会影响 pnpm install
# 与 dev 脚本的执行语义。此函数在启动前比对两者：
#   - 一致 → OK，无需处理（corepack 管理的 pnpm 会自动跟随 packageManager）；
#   - 不一致 → 若 corepack 可用则自动 prepare+activate 切换，成功 OK；
#     失败仅 WARN 并透出到启动页（不阻断启动，避免装好依赖却被版本提示卡住）。
function Test-PnpmVersion {
  $pkgPath = Join-Path $root "package.json"
  if (-not (Test-Path -LiteralPath $pkgPath)) {
    Write-Log "未找到 package.json，跳过 pnpm 版本检查" -Level INFO
    return
  }
  $expected = ""
  try {
    $pkg = Get-Content -Raw -LiteralPath $pkgPath | ConvertFrom-Json
    if ($pkg.packageManager -and $pkg.packageManager -match '^pnpm@(\S+)$') {
      $expected = $Matches[1]
    }
  } catch {
    Write-Log "解析 package.json 的 packageManager 失败：$($_.Exception.Message)" -Level WARN
    return
  }
  if (-not $expected) {
    Write-Log "package.json 未声明 packageManager 的 pnpm 版本，跳过一致性检查" -Level INFO
    return
  }

  # 获取本机实际 pnpm 版本
  # pnpm 命令存在但可能跑不起来：corepack 管理的 pnpm 在切换版本时若本地缓存
  # 损坏（如 .tools\pnpm\<ver>\bin 缺失），会报 "Failed to switch pnpm to
  # pnpm@<ver> ... ENOENT"，pnpm 完全不可用。此时继续往下走，pnpm install / dev
  # 会连锁失败，用户却只看到一堆看不懂的报错找不到根因。因此在预检阶段就把这种
  # 工具链损坏拦下：能读到版本号 = 命令可用（才继续走版本一致性 WARN 逻辑）；
  # 读不到版本号 = 命令本身坏了 = 致命，直接报错给修复指引。
  $actual = ""
  $pnpmErr = ""
  try {
    $pnpmCmd = Get-Command pnpm -ErrorAction SilentlyContinue
    if (-not $pnpmCmd) {
      Write-Log "未找到 pnpm 命令，请先执行 corepack enable（或 docs/guide-non-developer.md 4.2 双击 run-local.ps1）" -Level WARN
      return
    }
    # 用 2>&1 合并捕获 stderr：$ErrorActionPreference=Stop 下原生命令写 stderr 会
    # 直接抛异常打断探测，且 2>$null 会把真正有用的错误文本丢掉。合并后统一转
    # 字符串，既能读到版本号也能读到 corepack 切换失败的原始报错。
    $pnpmRaw = & pnpm -v 2>&1
    $pnpmExit = $LASTEXITCODE
    $pnpmLines = @($pnpmRaw | ForEach-Object { $_.ToString() })
    $actual = (($pnpmLines | Select-Object -First 1).Trim())
    if ($pnpmExit -ne 0) {
      # 版本号可能带 v 前缀或换行噪声，取首个像版本的行兜底
      $verLine = $pnpmLines | Where-Object { $_ -match '[0-9]+\.[0-9]+' } | Select-Object -First 1
      if ($verLine) { $actual = $verLine.Trim() }
    }
    $pnpmErr = (($pnpmLines | Where-Object {
      $_ -match "Failed to switch|ENOENT|not found|无法|不是内部或外部|ERR_|No such file"
    } | Select-Object -First 3) -join " ").Trim()
  } catch {
    $pnpmErr = "调用 pnpm 抛异常：$($_.Exception.Message)"
  }
  if (-not $actual) {
    # 命令在 PATH 上但跑不出版本号：典型是 corepack 切换版本缓存损坏。
    # 这是致命工具链问题，不是可跳过的 WARN——不修它 install/dev 一定失败。
    $fatal = "pnpm 工具链不可用：无法获取 pnpm 版本号（疑似 corepack 切换缓存损坏）"
    if ($pnpmErr) { $fatal += "`n  原始报错：$pnpmErr" }
    $fatal += "`n修复步骤："
    $fatal += "`n  1) corepack enable"
    $fatal += "`n  2) corepack prepare pnpm@$expected --activate   （会重建缓存，需联网一次）"
    $fatal += "`n  3) pnpm -v   应能输出版本号"
    $fatal += "`n仍不行则删除损坏的 corepack 缓存目录后重装 Node/pnpm，再重启应用。"
    $fatal += "`n详见 docs/guides/sync-after-pull.md。"
    Write-Log $fatal -Level ERROR
    throw $fatal
  }

  # 比较版本：忽略可能的 v 前缀
  $actualClean = $actual.TrimStart('v')
  $expectedClean = $expected.TrimStart('v')
  if ($actualClean -eq $expectedClean) {
    Write-Log ("pnpm 版本匹配：{0}（packageManager: pnpm@{1}）" -f $actual, $expected) -Level OK
    return
  }

  Write-Log ("pnpm 版本不匹配：本机 {0}，package.json 要求 {1}" -f $actual, $expected) -Level WARN

  # 尝试用 corepack 自动对齐
  $corepackCmd = Get-Command corepack -ErrorAction SilentlyContinue
  if ($corepackCmd) {
    Write-Log "检测到 corepack，尝试自动切换到要求的 pnpm 版本..." -Level STEP
    $cpLog = Join-Path $logDir "corepack-prepare.log"
    try {
      # corepack prepare 会下载对应版本并激活为默认（需联网一次）
      $res = & corepack prepare "pnpm@$expected" --activate 2>&1
      $cpCode = $LASTEXITCODE
      if ($res) { Add-Content -LiteralPath $cpLog -Value (($res | Out-String).Trim()) -Encoding utf8 -ErrorAction SilentlyContinue }
      if ($cpCode -eq 0) {
        # 对齐后重新验证
        $newVer = ((& pnpm -v 2>$null | Select-Object -First 1).Trim()).TrimStart('v')
        if ($newVer -eq $expectedClean) {
          Write-Log ("corepack 已自动切换 pnpm 至 {0}" -f $newVer) -Level OK
          return
        }
        Write-Log ("corepack prepare 执行后 pnpm 仍为 {0}，切换可能未生效" -f $newVer) -Level WARN
      } else {
        Write-Log ("corepack prepare 失败（exit=$cpCode），详见 $cpLog") -Level WARN
      }
    } catch {
      Write-Log "corepack 自动切换异常：$($_.Exception.Message)" -Level WARN
    }
  } else {
    Write-Log "未检测到 corepack（npm 自带），无法自动切换 pnpm 版本" -Level WARN
  }

  # 自动对齐失败：给出手动指引（不阻断启动）
  Write-Log "手动对齐方法（参考 docs/guides/sync-after-pull.md）：" -Level WARN
  Write-Log "  corepack enable && corepack prepare pnpm@$expected --activate" -Level WARN
  # 透出到启动页 banner（复用 stale_shell 字段——splash.html 读取它做可见提醒）
  $pnpmTip = ("pnpm 版本不匹配（本机 {0}，项目要求 {1}）；请执行 corepack enable && corepack prepare pnpm@{2} --activate 后重启应用" -f $actual, $expected, $expected)
  if ($script:ShellStaleMsg) {
    $script:ShellStaleMsg = $script:ShellStaleMsg + "；" + $pnpmTip
  } else {
    $script:ShellStaleMsg = $pnpmTip
  }
}

# ── 预检 1：node_modules 健康检查 ──
# pnpm 策略拒装 / 中断安装会留下「目录存在但不可用」的残缺依赖（缺
# .modules.yaml、缺 .bin/next，或关键依赖目录被清空）。直接启动 dev server 会
# 180 秒空等或触发 pnpm 的依赖状态检查失败。不健康时执行一次显式 pnpm install
# （CI 模式无交互），失败则立即报错并展示日志尾部，而不是空等。

# 检查 node_modules 下关键依赖目录是否「存在且非空」。pnpm 中断安装会留下
# 「目录在但内容空」的残缺（典型：typescript / @typescript/native 空目录 → tsc
# 垫片找不到入口，typecheck/build 崩）。这些是本仓库工具链与构建的硬依赖。
# 返回坏掉的相对路径列表（空数组 = 健康）。
function Get-BrokenKeyDeps {
  $broken = @()
  foreach ($rel in @("typescript", "@typescript/native", "next")) {
    $dir = Join-Path $root ("node_modules\" + $rel)
    if (-not (Test-Path -LiteralPath $dir)) {
      $broken += $rel
      continue
    }
    # pnpm 布局下顶层目录可能是指向 .pnpm store 的 symlink/junction：只要
    # 链接目标里能看到内容即算健康；空目录 / 悬空链接（目标缺失）都算坏。
    $files = @(Get-ChildItem -LiteralPath $dir -Force -ErrorAction SilentlyContinue)
    if ($files.Count -eq 0) { $broken += $rel }
  }
  return ,$broken
}

function Test-DevDependencies {
  $nextBin = Join-Path $root "node_modules\.bin\next*"
  $modulesYaml = Join-Path $root "node_modules\.modules.yaml"
  $brokenDeps = @(Get-BrokenKeyDeps)
  if ((Test-Path $modulesYaml) -and ((Get-ChildItem $nextBin -ErrorAction SilentlyContinue)) -and ($brokenDeps.Count -eq 0)) {
    Write-Log "node_modules 预检通过（.modules.yaml、.bin/next 与关键依赖目录均正常）" -Level INFO
    return
  }

  $why = @()
  if (-not (Test-Path $modulesYaml)) { $why += "缺 .modules.yaml" }
  if (-not (Get-ChildItem $nextBin -ErrorAction SilentlyContinue)) { $why += "缺 .bin/next" }
  foreach ($d in $brokenDeps) { $why += "关键依赖目录 node_modules/$d 为空或缺失" }
  Write-Log ("node_modules 不完整（{0}），执行显式 pnpm install..." -f ($why -join "；")) -Level WARN
  $env:CI = "true"
  $installOut = Join-Path $logDir "pnpm-install-stdout.log"
  $installErr = Join-Path $logDir "pnpm-install-stderr.log"
  $psiInstall = New-Object System.Diagnostics.ProcessStartInfo
  $psiInstall.FileName = "cmd.exe"
  $psiInstall.Arguments = "/c pnpm install > `"$installOut`" 2> `"$installErr`""
  $psiInstall.WorkingDirectory = $root
  $psiInstall.UseShellExecute = $false
  $psiInstall.CreateNoWindow = $true
  $installProc = [System.Diagnostics.Process]::Start($psiInstall)
  if (-not $installProc.WaitForExit(600000)) {
    try { taskkill /PID $installProc.Id /T /F 2>&1 | Out-Null } catch { }
    throw "pnpm install 超过 10 分钟未完成（可能网络/存储异常），已终止。详见 $installOut"
  }
  $errTail = Get-OutputTail -Path $installErr
  $outTail = Get-OutputTail -Path $installOut
  if ($installProc.ExitCode -ne 0) {
    throw "pnpm install 失败（exit=$($installProc.ExitCode)）。最近 stderr：`n$errTail`n最近 stdout：`n$outTail`n（完整输出见 $installOut 与 $installErr）"
  }
  # 复查：install 成功但仍缺结构 / 关键目录仍空 → 明确报错而不是静默通过
  $brokenDeps2 = @(Get-BrokenKeyDeps)
  $postMsg = @()
  if (-not (Test-Path $modulesYaml)) { $postMsg += "缺 .modules.yaml" }
  foreach ($d in $brokenDeps2) { $postMsg += "node_modules/$d 仍为空或缺失" }
  if ($postMsg.Count -gt 0) {
    throw ("pnpm install 退出码 0 但 node_modules 仍异常（{0}），请检查 $installOut" -f ($postMsg -join "；"))
  }
  Write-Log "pnpm install 完成，node_modules 预检通过" -Level OK
}

# ── 预检 2：桌面壳过期提醒 ──
# app.exe 是编译产物，tauri.conf.json（窗口配置编译期内嵌）/ src\*.rs /
# splash-assets（frontendDist 编译期嵌入）都比它新时，本次运行的仍是旧壳，
# 界面行为与源码不一致（例：改了启动页配置却出现黑屏/资源缺失）。
function Test-ShellFreshness {
  param([string]$ShellExe)
  $exeTime = (Get-Item -LiteralPath $ShellExe).LastWriteTime
  $newest = $exeTime
  $newestPath = ""
  foreach ($target in @(
    (Join-Path $root "src-tauri\tauri.conf.json"),
    (Join-Path $root "src-tauri\src"),
    (Join-Path $root "src-tauri\splash-assets")
  )) {
    $item = Get-Item -LiteralPath $target -ErrorAction SilentlyContinue
    if (-not $item) { continue }
    $files = if ($item.PSIsContainer) {
      Get-ChildItem -LiteralPath $target -Recurse -File -ErrorAction SilentlyContinue
    } else { $item }
    $latest = $files | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($latest -and $latest.LastWriteTime -gt $newest) {
      $newest = $latest.LastWriteTime
      $newestPath = $latest.FullName
    }
  }
  if ($newestPath) {
    Write-Log ("桌面壳（app.exe，{0:yyyy-MM-dd HH:mm}）比源码/配置旧（{1}，{2:yyyy-MM-dd HH:mm}），本次运行旧版界面逻辑。" -f $exeTime, (Split-Path $newestPath -Leaf), $newest) -Level WARN
    Write-Log "如遇黑屏/资源缺失/行为不符，请先执行：cd src-tauri; cargo build --release --features custom-protocol" -Level WARN
    # 透出到启动页的可见提醒（launch-status.json 的 stale_shell 字段）
    $script:ShellStaleMsg = "正在运行旧版桌面壳（app.exe 编译于 {0:MM-dd HH:mm}，源码此后有改动），界面可能不是最新逻辑；建议重编：cd src-tauri && cargo build --release --features custom-protocol" -f $exeTime
  } else {
    Write-Log "桌面壳与源码/配置时间戳一致（预检通过）" -Level INFO
    $script:ShellStaleMsg = $null
  }
}

# ── 预检 1.5：数据库 schema 同步（Drizzle）──
# 改用 Drizzle 后，数据层 schema 是 TS 源码（src/server/db/schema.ts），
# 运行时驱动为 better-sqlite3（Node 24 预编译绑定，无需本地编译）。
# 但表结构仍需同步进 db.sqlite：启动前执行一次 schema 同步（保留现有数据）。
# 改为调用 scripts/heal-db.cjs——它先清理上次失败残留的 __new_* 临时表，再执行
# drizzle-kit push --force；若遇缺列（no such column）会自动 ALTER 补列后重试。
# 这样旧库 push 失败无需手动 ALTER。失败时仍只告警、不阻断启动，避免卡死。
function Sync-DatabaseSchema {
  $schemaOut = Join-Path $logDir "drizzle-push-stdout.log"
  $schemaErr = Join-Path $logDir "drizzle-push-stderr.log"
  $psiSchema = New-Object System.Diagnostics.ProcessStartInfo
  $psiSchema.FileName = "cmd.exe"
    $psiSchema.Arguments = "/c node scripts/heal-db.cjs > `"$schemaOut`" 2> `"$schemaErr`""
  $psiSchema.WorkingDirectory = $root
  $psiSchema.UseShellExecute = $false
  $psiSchema.CreateNoWindow = $true
  $schemaProc = [System.Diagnostics.Process]::Start($psiSchema)
  if (-not $schemaProc.WaitForExit(120000)) {
    try { taskkill /PID $schemaProc.Id /T /F 2>&1 | Out-Null } catch {}
    Write-Log "drizzle-kit push 超时（120s），继续启动" -Level WARN
    return
  }
  if ($schemaProc.ExitCode -ne 0) {
    $errTail = Get-OutputTail -Path $schemaErr
    Write-Log ("drizzle-kit push 失败（exit=$($schemaProc.ExitCode)）：`n$errTail") -Level WARN
    Write-Log "数据库 schema 未能同步，应用可能在读写新字段时报错；请检查 DATABASE_URL 与 db.sqlite" -Level WARN
  } else {
    Write-Log "数据库 schema 已同步（drizzle-kit push）" -Level OK
  }
}

function New-JobObject {
  # ── 定义 C# 互操作类，调用 kernel32 的 Job Object API ──
  # Add-Type 需要现场编译 C#，在部分机器上要数秒。做成函数后由调用方决定时机：
  # Prebuilt 模式安排在 Tauri 窗口出现之后再调用，不拖慢「双击到见窗口」。
  Write-Log "创建 Windows Job Object（进程容器）..." -Level STEP
  $sig = @"
using System;
using System.Runtime.InteropServices;
public class WJ {
  [DllImport("kernel32.dll", CharSet=CharSet.Auto)]
  public static extern IntPtr CreateJobObject(IntPtr a, string n);
  [DllImport("kernel32.dll")]
  public static extern bool AssignProcessToJobObject(IntPtr j, IntPtr p);
  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern bool SetInformationJobObject(IntPtr c, int i, IntPtr x, int l);
  [DllImport("kernel32.dll")]
  public static extern bool CloseHandle(IntPtr h);
  [StructLayout(LayoutKind.Sequential)]
  public struct BASIC_LIMIT_INFO {
    public long PerProcessUserTimeLimit;
    public long PerJobUserTimeLimit;
    public uint LimitFlags;
    public UIntPtr MinimumWorkingSetSize;
    public UIntPtr MaximumWorkingSetSize;
    public uint ActiveProcessLimit;
    public UIntPtr Affinity;
    public uint PriorityClass;
    public uint SchedulingClass;
  }
}
"@
  Add-Type -TypeDefinition $sig -Language CSharp -ErrorAction Stop

  # ── 第二步：创建 Job 对象 ──
  $job = [WJ]::CreateJobObject([IntPtr]::Zero, $null)
  if ($job -eq [IntPtr]::Zero) { throw "CreateJobObject 返回空句柄" }
  Write-Log "Job Object 创建成功" -Level OK

  # ── 第三步：设置「关闭窗口即终止」标志（JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE）──
  # 必须用 JobObjectBasicLimitInformation(=2) + 完整 BASIC_LIMIT_INFO 结构体
  # （LimitFlags 位于偏移 16）。旧代码用 class=7 只写 4 字节，SetInformationJobObject
  # 一直静默失败，该标志从未真正生效（2026-09-01 修复）。
  $info = New-Object "WJ+BASIC_LIMIT_INFO"
  $info.LimitFlags = 0x2000
  $size = [System.Runtime.InteropServices.Marshal]::SizeOf([type][WJ+BASIC_LIMIT_INFO])
  $m = [System.Runtime.InteropServices.Marshal]::AllocHGlobal($size)
  [System.Runtime.InteropServices.Marshal]::StructureToPtr($info, $m, $false)
  $ok = [WJ]::SetInformationJobObject($job, 2, $m, $size)
  [System.Runtime.InteropServices.Marshal]::FreeHGlobal($m)
  if ($ok) {
    Write-Log "已设置「关闭窗口自动终止所有子进程」标志" -Level OK
  } else {
    Write-Log ("设置 KILL_ON_JOB_CLOSE 失败（Win32 错误码 {0}），改由启动器退出时兜底清理子进程" -f [System.Runtime.InteropServices.Marshal]::GetLastWin32Error()) -Level WARN
  }
  return $job
}

# 本运行拉起、需要在异常时回收的子进程（在 try 外初始化，catch 里统一清理）
$tauriProc = $null
$devProc = $null
$p = $null

try {
  # ── 启动进程 ──
  $root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

  # ── .env 前置检查 ──
  # 缺 .env 时 pnpm dev 会因 src/env.js 校验 DATABASE_URL / BETTER_AUTH_* 未定义而
  # 直接甩出一堆 "Invalid environment variables"，用户根本看不出是「缺文件」。
  # 这里提前给出清晰指引（对应 AGENTS.md 硬规则 4：失败路径必须有用户可见出口）。
  if (-not (Test-Path (Join-Path $root ".env"))) {
    Write-Log "未检测到 .env 配置文件。" -Level ERROR
    Write-Log "开发请先运行 tools\start\run-local.ps1 生成本地配置（幂等，不会覆盖已有 .env）。" -Level ERROR
    throw "缺少 .env：请先双击 tools\start\run-local.ps1（或执行 scripts\prepare-local-run.ps1）完成本地初始化后再启动。"
  }

  if ($Prebuilt) {
    # 2026-09-01 优化：双击后的第一件事就是拉起预编译壳，让用户立刻看到窗口。
    # 旧流程在弹窗之前还要依次做端口清理 / 缓存指纹 / Add-Type 编译 C#（Job Object），
    # 这几步在部分机器上要数秒，窗口迟迟不出现；现在它们全部挪到窗口出现之后执行，
    # 由内嵌启动页（splash.html）展示进度，服务 Ready 后自动导航。
    # 地址仍用 127.0.0.1，避免 Windows 把 localhost 优先解析到 ::1（IPv6）。
    $tauriExe = Join-Path $root "src-tauri\target\release\app.exe"
    if (-not (Test-Path $tauriExe)) {
      $tauriExe = Join-Path $root "src-tauri\target\debug\app.exe"
    }
    if (-not (Test-Path $tauriExe)) {
      throw "找不到预编译 Tauri 壳：src-tauri\target\release\app.exe（或 debug）。请先执行 cargo build 或 pnpm tauri build。"
    }
    # 0.4 工具链门禁：在弹出 Tauri 壳之前先确认 pnpm / node_modules 没坏到不可用。
    # 命中致命损坏 → throw → dev-launcher 提前退出 → python 启动器在窗口出现前
    # 弹 MessageBox 告知根因（人类可见出口），而不是先弹黑窗口再慢慢报错。
    Test-ToolchainGate

    Test-ShellFreshness -ShellExe $tauriExe

    # 1. 清理上次运行残留的同项目 Tauri 壳：启动器上次失败退出时不带清理，
    #    会留下卡在启动页的僵尸窗口，下次启动出现两个窗口叠在一起。
    Get-CimInstance Win32_Process -Filter "Name='app.exe'" -ErrorAction SilentlyContinue |
      Where-Object { $_.CommandLine -like "*$root*" } |
      ForEach-Object {
        Write-Log ("发现上次残留的 Tauri 壳（PID {0}），正在终止..." -f $_.ProcessId) -Level WARN
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
      }

    # 2. 确保 Tauri 内置启动页资源就位（tauri://localhost/splash.html），随后立刻弹窗
    Ensure-SplashResource
    $psiTauri = New-Object System.Diagnostics.ProcessStartInfo
    $psiTauri.FileName = $tauriExe
    $psiTauri.WorkingDirectory = $root
    $psiTauri.UseShellExecute = $false
    $psiTauri.Environment["COMFYAPP_PROJECT_ROOT"] = $root
    $psiTauri.Environment["COMFYAPP_DEV_URL"] = "http://127.0.0.1:3000/workspace"
    $tauriProc = [System.Diagnostics.Process]::Start($psiTauri)
    Write-Log ("预编译 Tauri 壳已启动（PID: {0}）：{1}" -f $tauriProc.Id, $tauriExe) -Level OK
    Write-Log "Tauri 桌面壳已启动，正在启动本地服务…" -Level STEP
    Write-LaunchStatus -Phase "port-check" -Progress 0.05 -Message "桌面壳已启动，正在检查端口占用…"

    # 2. 窗口已出现，再补做准备工作：进程容器 → 端口清理 → 缓存策略
    $h = New-JobObject
    $null = [WJ]::AssignProcessToJobObject($h, $tauriProc.Handle)
    Reset-DevPorts
    Write-LaunchStatus -Phase "cache" -Progress 0.12 -Message "端口已就绪，处理编译缓存与依赖预检…"
    Sync-NextCache
    Test-PnpmVersion
    Test-DevDependencies
    Write-LaunchStatus -Phase "dev-server-starting" -Progress 0.2 -Message "正在启动本地服务（Next.js dev server）…"

    # 3. 启动 Next.js dev server（最先启动）：其冷编译是启动耗时主轴，
    #    把它提前到 DB schema 预检之前，让后者与编译并行，整体启动更短。
    #    dev 脚本本身已带 --turbo（Turbopack，见 package.json "dev"），无需在此重复。
    $psiDev = New-Object System.Diagnostics.ProcessStartInfo
    $psiDev.FileName = "cmd.exe"
    # 项目使用 pnpm；固定 -H 127.0.0.1 避免 Windows 把 localhost 解析到 ::1（IPv6）
    # 导致 127.0.0.1 健康检查失败。输出重定向到 log/ 方便排查「启动但不响应」。
    # 2026-09-01 修复：重定向文件名带本次运行时间戳。此前固定为 nextjs-stdout.log，
    # 上次运行的残留进程（如挂死的 pnpm install）仍握着该文件句柄时，cmd 的「>」
    # 重定向会因「文件被占用」打开失败 → cmd 瞬间退出 exit=1 且不产生任何输出，
    # 表现为「Next.js dev server 提前退出（exit=1）」却查不到原因。
    $nextOut = Join-Path $logDir ("nextjs-stdout-{0}.log" -f $runTimestamp)
    $nextErr = Join-Path $logDir ("nextjs-stderr-{0}.log" -f $runTimestamp)
    # 只保留最近 5 次的输出文件，避免 log 目录无限堆积
    foreach ($prefix in @("nextjs-stdout-", "nextjs-stderr-")) {
      Get-ChildItem $logDir -File -Filter "$prefix*.log" -ErrorAction SilentlyContinue |
        Sort-Object Name -Descending | Select-Object -Skip 5 |
        Remove-Item -Force -ErrorAction SilentlyContinue
    }
    # pnpm 11 不再剥离「--」，会把它原样传给脚本；next dev 收到字面量「--」后把
    # -p 当成目录参数报「Invalid project directory」。因此直接跟参数，不写「--」。
    $psiDev.Arguments = "/c pnpm dev -p 3000 -H 127.0.0.1 > `"$nextOut`" 2> `"$nextErr`""
    $psiDev.WorkingDirectory = $root
    $psiDev.UseShellExecute = $false
    $psiDev.CreateNoWindow = $true
    $devProc = [System.Diagnostics.Process]::Start($psiDev)
    Write-Log ("Next.js dev server 已启动（PID: {0}）" -f $devProc.Id) -Level OK
    $null = [WJ]::AssignProcessToJobObject($h, $devProc.Handle)
    Write-Log "Tauri 壳与 dev server 已绑定到同一 Job Object（关闭窗口时一起清理）" -Level OK
    Write-LaunchStatus -Phase "dev-server-starting" -Progress 0.25 -Message "本地服务进程已启动，等待就绪…"

    # 3.5 DB schema 同步（drizzle-kit push）与 dev 编译并行，不再阻塞端口就绪判定
    Sync-DatabaseSchema

    # 4. 等服务 Ready（避免 Tauri 导航时看到 ERR_CONNECTION_REFUSED）
    Write-Log "等待本地服务就绪（http://127.0.0.1:3000）..." -Level STEP
    $ready = $false
    for ($i = 0; $i -lt 180; $i++) {
      # 若进程已提前退出，直接报失败并输出其 stderr/stdout 尾部，避免空等 180 秒
      if ($devProc.HasExited) {
        $errTail = Get-OutputTail -Path $nextErr
        $outTail = Get-OutputTail -Path $nextOut
        throw "Next.js dev server 提前退出（exit=$($devProc.ExitCode)）。最近 stderr：`n$errTail`n最近 stdout：`n$outTail`n（完整输出见 $nextOut 与 $nextErr）"
      }
      try {
        $r = Invoke-WebRequest -Uri "http://127.0.0.1:3000" -TimeoutSec 1 -UseBasicParsing -ErrorAction SilentlyContinue
        if ($r.StatusCode -eq 200) { $ready = $true; break }
      } catch { }
      # 每秒刷新启动页进度（python 启动器已提前退出，真实进度由本脚本接管）
      Write-LaunchStatus -Phase "dev-server-starting" `
        -Progress (0.25 + [math]::Min(0.6, $i * 0.6 / 180.0)) `
        -Message ("正在等待本地服务就绪（http://127.0.0.1:3000，第 {0}s）…" -f $i)
      Start-Sleep -Seconds 1
    }
    if (-not $ready) {
      $errTail = Get-OutputTail -Path $nextErr
      $outTail = Get-OutputTail -Path $nextOut
      throw "180 秒内未检测到 http://127.0.0.1:3000 服务就绪。Next.js 最近 stderr：`n$errTail`n最近 stdout：`n$outTail`n（完整输出见 $nextOut 与 $nextErr）"
    }
    Write-Log "服务器已就绪，桌面壳正在加载应用…" -Level OK
    Write-LaunchStatus -Phase "dev-server-ready" -Progress 0.85 -Message "本地服务已就绪，桌面壳正在加载应用…"
    $p = $tauriProc  # 后续 WaitForExit 以 Tauri 窗口生命周期为锚点
  } else {
    Reset-DevPorts
    Sync-NextCache
    Test-PnpmVersion
    Test-DevDependencies
    Sync-DatabaseSchema
    $h = New-JobObject

    # 确保 Tauri 内置启动页资源就位（tauri://localhost/splash.html）
    Ensure-SplashResource

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = "cmd.exe"
    if ($Tauri) {
      # Tauri 桌面壳：tauri CLI 会先跑 beforeDevCommand（pnpm dev）再弹桌面窗口；
      # 整棵进程树都在本 Job Object 内，关闭窗口自动全清
      $psi.Arguments = "/c pnpm tauri dev"
    } else {
      # Web 模式：显式 -p 3000，端口已在上一步清干净，保证新实例一定落在 3000
      $psi.Arguments = "/c pnpm dev -p 3000"
    }
    $psi.WorkingDirectory = (Get-Location).Path
    $psi.UseShellExecute = $false
    $p = [System.Diagnostics.Process]::Start($psi)
    Write-Log ("开发服务器进程已启动（PID: {0}）" -f $p.Id) -Level OK

    # 把进程绑到 Job 对象
    $null = [WJ]::AssignProcessToJobObject($h, $p.Handle)
    Write-Log "进程已绑定到 Job Object（关窗口时一起清理）" -Level OK
  }

  # ── 第五步：显示启动摘要，等待进程退出 ──
  if ($Prebuilt) {
    Show-Summary -Title "Comfy-APP 预编译桌面壳已启动" -Lines @(
      "模式   : 预编译 Tauri 壳（服务就绪后弹出）",
      "dev    : PID $($devProc.Id)",
      "tauri  : PID $($tauriProc.Id)",
      "地址   : http://127.0.0.1:3000",
      "停止   : 关闭桌面窗口（自动清理全部子进程）"
    )
  } elseif ($Tauri) {
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
  #
  #   ⚠ 只在「纯 Web 模式」（既非 Prebuilt 也非 Tauri）才开浏览器：
  #     - Prebuilt：桌面壳已在第四步等服务就绪后启动，界面就是 Tauri 窗口，
  #       再开浏览器属于多余（2026-08-29 修复：此前因 elseif 未排除 $Prebuilt，
  #       Prebuilt 会落进本分支，导致双击 start-tauri.exe 时浏览器被一并打开）。
  #     - Tauri：tauri dev 自己编译/启动 dev server 并弹出桌面窗口，无需浏览器。
  if ($Tauri) {
    Write-Log "Tauri 模式：等待 tauri dev 编译并弹出桌面窗口..." -Level STEP
    Write-Log "等待本地服务就绪（http://127.0.0.1:3000）..." -Level STEP
    $ready = $false
    for ($i = 0; $i -lt 180; $i++) {
      try {
        $r = Invoke-WebRequest -Uri "http://127.0.0.1:3000" -TimeoutSec 1 -UseBasicParsing -ErrorAction SilentlyContinue
        if ($r.StatusCode -eq 200) { $ready = $true; break }
      } catch { }
      Start-Sleep -Seconds 1
    }
    if ($ready) {
      Write-Log "服务器已就绪（Tauri 桌面壳加载中）" -Level OK
    } else {
      Write-Log "180 秒内未检测到服务就绪，Tauri 仍在编译中，请稍候" -Level WARN
    }
  } elseif (-not $Prebuilt -and $env:NO_OPEN -ne "1") {
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

  # 阻塞等待主进程退出
  if ($Prebuilt) {
    # 预编译模式：以 Tauri 桌面壳窗口为生命周期锚点，关闭窗口即结束全部。
    # 之前这里等待 dev server，导致用户关闭 Tauri 后 PowerShell 仍挂起并锁住 dev-launcher.log。
    Write-Log "等待 Tauri 桌面壳或 dev server 任一退出..." -Level INFO
    while (-not $tauriProc.HasExited -and -not $devProc.HasExited) {
      Start-Sleep -Milliseconds 500
    }
    if (-not $devProc.HasExited) {
      Write-Log "Tauri 已退出，正在终止 dev server..." -Level STEP
      # 用 taskkill /T 杀整棵进程树：Process.Kill() 只杀 cmd.exe 本身，
      # 其下的 pnpm/node 子进程会残留并继续占用 3000 端口。
      try { taskkill /PID $devProc.Id /T /F 2>&1 | Out-Null } catch {}
      try { $devProc.WaitForExit(5000) } catch {}
    }
    if (-not $tauriProc.HasExited) {
      Write-Log "dev server 已退出，正在终止 Tauri 壳..." -Level STEP
      try { taskkill /PID $tauriProc.Id /T /F 2>&1 | Out-Null } catch {}
      try { $tauriProc.WaitForExit(5000) } catch {}
    }
    Write-Log "全部子进程已退出，正在释放 Job Object..." -Level STEP
  } else {
    Write-Log "等待开发服务器退出..." -Level INFO
    $p.WaitForExit()
    Write-Log "开发服务器已退出，正在释放 Job Object..." -Level STEP
  }
  $null = [WJ]::CloseHandle($h)
  Write-Log "全部子进程已清理，启动器正常退出" -Level OK
}
catch {
  Write-Log "启动失败：" -Level ERROR
  Write-Log $_.Exception.Message -Level ERROR
  Write-Log $_.ScriptStackTrace -Level ERROR
  # 启动页失败态：让内嵌启动页把「启动失败」红字 + 日志面板直接展示给用户
  #（python 启动器的失败弹窗依赖它自己存活到此刻，不可依赖）
  if ($Prebuilt) {
    $failMsg = $_.Exception.Message
    if ($failMsg.Length -gt 160) { $failMsg = $failMsg.Substring(0, 160) + "…" }
    Write-LaunchStatus -Phase "error" -Progress 1.0 -Message ("启动失败：{0}" -f ($failMsg -replace "`r?`n", " ")) -IsError
  }
  # 2026-09-01 修复：失败时回收本次已拉起的进程树。此前直接退出，会留下卡在
  # 启动页的僵尸 Tauri 窗口和挂死的 dev server / pnpm 进程；残留进程还握着
  # nextjs-*.log 句柄，导致下次启动 cmd 重定向失败、瞬间 exit=1。
  foreach ($proc in @($tauriProc, $devProc, $p)) {
    if ($proc -and -not $proc.HasExited) {
      Write-Log ("清理子进程树：PID {0}" -f $proc.Id) -Level STEP
      try { taskkill /PID $proc.Id /T /F 2>&1 | Out-Null } catch { }
    }
  }
  if ($h -and $h -ne [IntPtr]::Zero) { $null = [WJ]::CloseHandle($h) }
  Write-Log ("详情请查看日志：{0}" -f $currentLog) -Level WARN
}
finally {
  try { Stop-Transcript -ErrorAction SilentlyContinue } catch {}
  # 将本次运行完整日志归档到按年月/时分秒命名的历史文件
  if (Test-Path $currentLog) {
    try {
      Add-Content -Path $runLog -Value (Get-Content -Raw $currentLog) -Encoding utf8 -ErrorAction SilentlyContinue
    } catch { }
  }
  $runEndMarker = "===== 运行结束 {0} =====" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss")
  Add-Content -Path $runLog -Value $runEndMarker -Encoding utf8 -ErrorAction SilentlyContinue
}
