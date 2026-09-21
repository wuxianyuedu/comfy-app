# app-port.ps1 — 应用端口解析的唯一事实源（PowerShell 侧），与 Node / Python /
# Rust 侧的 scripts/app-port.mjs、scripts/app_port.py、src-tauri/src/single_instance.rs
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

# 规范化检出路径：转正斜杠 + 转小写 + 去尾斜杠（跨四语言约定，§1.1）。
# 只对**相对路径**做 GetFullPath —— 绝对路径原样处理，禁止无条件拼 cwd
# （Node / Python 侧历史实现都栽在这里：同一检出在不同 cwd 下推出不同端口，
#  与「同一检出恒定同端口」的多检出并行承诺矛盾，详见 scripts/app-port.mjs）。
function Get-NormalizedRootForPort([string]$RootPath) {
  $raw = if ($null -eq $RootPath) { '' } else { [string]$RootPath }
  # Windows 盘符绝对路径（F:\ 或 F:/）与 UNC（\\）在 POSIX 上
  # IsPathRooted 认不出，必须显式判据；否则会被当相对路径拼上 cwd。
  $winAbsolute = ($raw -match '^[a-zA-Z]:[\\/]') -or ($raw.StartsWith('\\'))
  $absolute = $winAbsolute -or [System.IO.Path]::IsPathRooted($raw)
  $resolved = if ($absolute) { $raw } else { [System.IO.Path]::GetFullPath($raw) }
  return $resolved.Replace('\', '/').ToLowerInvariant().TrimEnd('/')
}

function Get-AppPortFromRoot([string]$RootPath) {
  try {
    $normalized = Get-NormalizedRootForPort $RootPath
    return [int](3200 + ((Get-Fnv1a32 $normalized) % 800))
  } catch {
    return 3100
  }
}

# 读 .env 的 COMFYAPP_PORT；未配置 / 非法 / 文件缺失时返回 $null
#
# 形态与另三侧实现严格对齐（Node readEnvFileValue / Python read_env_port /
# Rust read_dot_env_value，ISSUE #821）：行首允许空白、值去掉成对引号与行尾
# 注释（`# 固定端口` 是 dotenv 常见写法）、只取第一个匹配行。四侧对同一份
# .env 必须读出同一个值 —— 否则「同一处配置、两侧端口一致」又是文档承诺。
function Get-DotEnvAppPort([string]$RootPath) {
  $envFile = Join-Path $RootPath ".env"
  if (-not (Test-Path -LiteralPath $envFile)) { return $null }
  $line = Get-Content -LiteralPath $envFile -Encoding UTF8 -ErrorAction SilentlyContinue |
    Where-Object { $_ -notmatch "^\s*#" -and $_ -match "^\s*COMFYAPP_PORT\s*=" } |
    Select-Object -First 1
  if (-not $line) { return $null }
  $val = (($line -split "=", 2)[1] -split "\s+#")[0].Trim()
  if ($val.Length -ge 2 -and $val[0] -eq $val[-1] -and ($val[0] -eq '"' -or $val[0] -eq "'")) {
    $val = $val.Substring(1, $val.Length - 2)
  }
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
