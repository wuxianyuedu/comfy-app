#Requires -Version 5.1
<#
build-all.ps1 — 一键发布构建入口（原 tools\build\build-all.bat，逻辑在 tools\scripts\）

编排一步：
  1) tools\scripts\build-tauri-release.ps1 —— 构建 release 版 Tauri 壳（app.exe）

产物 `src-tauri\target\release\app.exe` 就是**唯一**的启动入口：编排（dev server /
端口 / 缓存 / 回收）由壳自己承担，不再打包第二层启动器 exe（ISSUE #784）。

用法：
  双击 <项目根>\tools\build\build-all.ps1
  或在终端执行：pwsh -NoProfile -ExecutionPolicy Bypass -File tools\build\build-all.ps1

详见 tools/README.md。
#>
[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

. (Join-Path $PSScriptRoot "..\..\scripts\entry-common.ps1")

$root = Get-ProjectRoot
Set-Location $root

Write-Host "[INFO] 开始一键发布构建（release 壳 app.exe）..." -ForegroundColor Cyan
Write-Host ""

# 入口自己也计一轮（含子进程启动开销），保证双击场景里「最后一行」是总耗时：
# 逻辑脚本的汇总行会被 Invoke-Entry 的子进程输出带出来，但进度提示、依赖检查这些
# 入口侧的输出排在它之后，收尾前再补一行总账，构建者关窗口前最后读到的就是它。
$watch = [System.Diagnostics.Stopwatch]::StartNew()

$code = Invoke-Entry -Root $root -ScriptPath "tools\scripts\build-all.ps1"

$elapsed = $watch.Elapsed
if ($elapsed.TotalHours -ge 1) {
    $elapsedText = "{0} 时 {1:D2} 分 {2:D2} 秒" -f [int]$elapsed.TotalHours, $elapsed.Minutes, $elapsed.Seconds
} elseif ($elapsed.TotalMinutes -ge 1) {
    $elapsedText = "{0} 分 {1:0.0} 秒" -f [int]$elapsed.TotalMinutes, ($elapsed.Seconds + $elapsed.Milliseconds / 1000)
} else {
    $elapsedText = "{0:0.0} 秒" -f $elapsed.TotalSeconds
}

Write-Host ""
if ($code -ne 0) {
    Write-Host "[ERROR] 发布构建失败，退出码 $code 。详情见 log\tools\build-*.log" -ForegroundColor Red
    Write-Host "[耗时] 本次发布构建共用时 $elapsedText" -ForegroundColor Yellow
} else {
    Write-Host "[耗时] 本次发布构建共用时 $elapsedText" -ForegroundColor Green
}

exit (Complete-Entry -ExitCode $code)
