[CmdletBinding()]
param()
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$TOOLS_DIR = Split-Path -Parent $PSScriptRoot
$PROJECT_ROOT = Split-Path -Parent $TOOLS_DIR
Set-Location $PROJECT_ROOT

$LOG_DIR = Join-Path $PROJECT_ROOT "log\tool"
if (-not (Test-Path $LOG_DIR)) { New-Item -ItemType Directory -Force $LOG_DIR | Out-Null }
$LOG = Join-Path $LOG_DIR "build-all.log"
if (Test-Path $LOG) { Remove-Item $LOG }

function Log {
    param([string]$Msg)
    Write-Host $Msg
    Add-Content -Encoding Default -Path $LOG -Value $Msg
}
function Invoke-Logged {
    param([string]$Command)
    $sb = [scriptblock]::Create($Command)
    & $sb 2>&1 | ForEach-Object {
        $line = "$_"
        Write-Host $line
        Add-Content -Encoding Default -Path $LOG -Value $line
        $script:LAST_INVOKE_CODE = $LASTEXITCODE
    }
    $script:LAST_INVOKE_CODE = $LASTEXITCODE
}
function Open-Log {
    Start-Process -FilePath notepad -ArgumentList $LOG
}

Log "=========================================================="
Log "  Comfy APP - 一键发布构建"
Log "=========================================================="
Log "  1) 构建 release Tauri 壳   (build-tauri-release)"
Log "  2) 打包 start-tauri.exe    (build-launcher)"
Log "=========================================================="
Log ""

Log "[1/2] 构建 release Tauri 壳 ..."
& "$PSScriptRoot\build-tauri-release.ps1"
if ($LASTEXITCODE -ne 0) {
    Log "[错误] Tauri 壳构建失败，已中止发布流程。"
    exit 1
}

Log ""
Log "[2/2] 打包 start-tauri.exe ..."
& "$PSScriptRoot\build-launcher.ps1"
if ($LASTEXITCODE -ne 0) {
    Log "[错误] start-tauri.exe 打包失败，已中止发布流程。"
    exit 1
}

Log ""
Log "=========================================================="
Log "  全部完成"
Log "  可双击 $PROJECT_ROOT\start-tauri\start-tauri.exe 启动应用"
Log "  （将自动使用 release 版 Tauri 壳，启动更快）"
Log "=========================================================="
Log ""
