# check-app-port-vectors.ps1 — 端口推导的跨语言一致性自检（PowerShell 侧）。
#
# 读取 tests/fixtures/app-port-vectors.json（与 Node / Python / Rust 侧读同一份），
# 断言 app-port.ps1 的算法对同一批 input→port 与其余三侧一致。任一侧漂移即
# 退出码非 0（ISSUE #489 缺陷 4）。
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

if ($diffs.Count -gt 0) {
  Write-Output 'FAIL PowerShell 侧与共享向量不一致：'
  $diffs | ForEach-Object { Write-Output "  - $_" }
  exit 1
}
Write-Output "OK PowerShell 侧与共享向量一致（$($vectors.Count) 条）"
exit 0
