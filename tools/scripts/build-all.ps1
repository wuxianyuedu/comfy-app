[CmdletBinding()]
param()
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$TOOLS_DIR = Split-Path -Parent $PSScriptRoot
$PROJECT_ROOT = Split-Path -Parent $TOOLS_DIR
Set-Location $PROJECT_ROOT

. "$PSScriptRoot\Log-Common.ps1"
Initialize-Log "build-all.log"

Log "=========================================================="
Log "  Comfy APP - 一键发布构建"
Log "=========================================================="
Log "  构建 release Tauri 壳（app.exe 就是唯一启动入口）"
Log "=========================================================="
Log ""

# 整轮发布构建的总耗时（子步骤自己也会打印本步耗时，这里只报总账）。
$totalWatch = Start-LogStopwatch

Log "[1/1] 构建 release Tauri 壳 ..."
& "$PSScriptRoot\build-tauri-release.ps1"
if ($LASTEXITCODE -ne 0) {
    Log "[错误] Tauri 壳构建失败，已中止发布流程。"
    Log-Elapsed -Stopwatch $totalWatch -Label "发布构建总"
    exit 1
}

Log ""
Log "=========================================================="
Log "  全部完成"
Log ("  总耗时：{0}" -f (Format-Elapsed -Elapsed $totalWatch.Elapsed))
Log "  可双击 $PROJECT_ROOT\src-tauri\target\release\app.exe 启动应用"
Log "  （或用入口 tools\start\start-tauri.ps1 启动）"
Log "=========================================================="
Log ""
