# check-app-port-vectors.ps1 — 端口推导的跨语言一致性自检（PowerShell 侧）。
#
# 读取 tests/fixtures/app-port-vectors.json（与 Node / Python / Rust 侧读同一份），
# 断言 app-port.ps1 的算法对同一批 input→port 与其余三侧一致。任一侧漂移即
# 退出码非 0（ISSUE #489 缺陷 4）。
#
# 覆盖两组共享向量：`vectors`（路径 → 端口推导）与 `envVectors`（.env 单值解析）。
#
# 用法：pwsh -File scripts/check-app-port-vectors.ps1 [向量文件路径]
[CmdletBinding()]
param([string]$VectorsPath)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $VectorsPath) {
  $VectorsPath = Join-Path (Split-Path -Parent $here) 'tests/fixtures/app-port-vectors.json'
}
. (Join-Path $here 'app-port.ps1')

$json = Get-Content -LiteralPath $VectorsPath -Encoding UTF8 -Raw | ConvertFrom-Json
$vectors = @($json.vectors)
if ($vectors.Count -lt 5) {
  Write-Output "FAIL 向量不足（$($vectors.Count) < 5）—— 防止误删后自检静默全绿"
  exit 1
}

$diffs = @()
foreach ($v in $vectors) {
  $input = [string]$v.input
  $norm = Get-NormalizedRootForPort $input
  if ($norm -ne [string]$v.normalized) {
    $diffs += "规范化 '$input': '$norm' != '$($v.normalized)'"
  }
  $fnv = Get-Fnv1a32 $norm
  if ([uint64]$fnv -ne [uint64]$v.fnv1a32) {
    $diffs += "FNV '$input': $fnv != $($v.fnv1a32)"
  }
  $port = Get-AppPortFromRoot $input
  if ($port -ne [int]$v.port) {
    $diffs += "端口 '$input': $port != $($v.port)"
  }
}

# `.env` 单值解析（ISSUE #821，ISSUE #1941 补齐）：与 Node / Python / Rust 同读
# envVectors。此前 PowerShell 侧**只跑 vectors**，于是「四侧读同一份 .env」实际只
# 有三侧在判 —— 而 PowerShell 侧恰是历史上最容易漂的那一侧（`-split "=", 2` 与另三侧
# 的正则对「值里含 =」处理不同，规范 §1.1.1 记着这一笔）。向量在临时目录里造，不读
# 仓库根的 .env（用例的可通过性只能取决于用例自己造的东西）。
$envVectors = @($json.envVectors)
if ($envVectors.Count -lt 4) {
  Write-Output "FAIL envVectors 不足（$($envVectors.Count) < 4）—— 防止误删后自检静默全绿"
  exit 1
}
$tmpDir = Join-Path ([System.IO.Path]::GetTempPath()) ("app-port-vectors-{0}" -f $PID)
New-Item -ItemType Directory -Path $tmpDir -Force | Out-Null
try {
  foreach ($v in $envVectors) {
    Set-Content -LiteralPath (Join-Path $tmpDir '.env') -Value ([string]$v.content) -NoNewline -Encoding UTF8
    $got = Get-DotEnvAppPort $tmpDir
    $want = $v.port
    if ($null -eq $want) { $want = $null }
    if ($got -ne $want) {
      $diffs += ".env 解析 '$($v.content)': $got != $want（$($v.note)）"
    }
  }
} finally {
  Remove-Item -LiteralPath $tmpDir -Recurse -Force -ErrorAction SilentlyContinue
}

if ($diffs.Count -gt 0) {
  Write-Output 'FAIL PowerShell 侧与共享向量不一致：'
  $diffs | ForEach-Object { Write-Output "  - $_" }
  exit 1
}
Write-Output "OK PowerShell 侧与共享向量一致（$($vectors.Count) 条 + $($envVectors.Count) 条 .env 向量）"
exit 0
