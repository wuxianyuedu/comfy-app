# app-port.ps1 — 应用端口解析的唯一事实源（PowerShell 侧），与 Node / Python /
# Rust 侧的 scripts/app-port.mjs、start_tauri_launcher.py、src-tauri/src/single_instance.rs
# 是同一算法的多语言实现，改动必须四处同步（launch-and-build.md §1.1 / §1.4）。
#
# 取值优先级：
#   1. .env 显式 COMFYAPP_PORT（每个检出各自的 .env，要固定端口时配置）；
#   2. 按检出绝对路径稳定推导——同一检出恒定同端口，多份检出并行互不冲突；
#   3. 兜底 3100（仅在路径推导不可用的异常情况）。
#
# 推导算法：对「绝对路径、反斜杠转正斜杠、转小写」的 UTF-8 字节取 FNV-1a
# 32 位哈希，映射到 3200..3999：port = 3200 + (fnv1a32(path) % 800)。

function Get-Fnv1a32([string]$Text) {
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($Text)
  $h = [uint64]2166136261
  foreach ($b in $bytes) {
    $h = ($h -bxor [uint64]$b)
    $h = ($h * [uint64]16777619) -band [uint64]4294967295
  }
  return $h
}

function Get-AppPortFromRoot([string]$RootPath) {
  try {
    $normalized = ([System.IO.Path]::GetFullPath($RootPath)).Replace('\', '/').ToLowerInvariant()
    return [int](3200 + ((Get-Fnv1a32 $normalized) % 800))
  } catch {
    return 3100
  }
}

# 读 .env 的 COMFYAPP_PORT；未配置 / 非法 / 文件缺失时返回 $null
function Get-DotEnvAppPort([string]$RootPath) {
  $envFile = Join-Path $RootPath ".env"
  if (-not (Test-Path -LiteralPath $envFile)) { return $null }
  $line = Get-Content -LiteralPath $envFile -Encoding UTF8 -ErrorAction SilentlyContinue |
    Where-Object { $_ -match "^\s*COMFYAPP_PORT\s*=" } | Select-Object -First 1
  if (-not $line) { return $null }
  $val = (($line -split "=", 2)[1]).Trim().Trim('"').Trim("'")
  $port = 0
  if ([int]::TryParse($val, [ref]$port) -and $port -ge 1 -and $port -le 65535) { return $port }
  return $null
}

# 最终端口：.env 显式值优先，否则按检出路径推导，异常时兜底 3100
function Get-AppPort([string]$RootPath) {
  $fromEnv = Get-DotEnvAppPort $RootPath
  if ($null -ne $fromEnv) { return $fromEnv }
  return Get-AppPortFromRoot $RootPath
}
