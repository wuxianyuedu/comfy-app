[CmdletBinding()]
param()
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$TOOLS_DIR = Split-Path -Parent $PSScriptRoot
$PROJECT_ROOT = Split-Path -Parent $TOOLS_DIR
Set-Location $PROJECT_ROOT

Write-Host "=========================================================="
Write-Host "  Comfy APP - 重新打包 start-tauri.exe"
Write-Host "=========================================================="
Write-Host "  项目根目录: $PROJECT_ROOT"
Write-Host ""

function Test-Command {
    param([string]$Name)
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

if (-not (Test-Command python)) {
    Write-Host "[错误] 未找到 python，请先安装 Python 3.10+ 并加入 PATH。"
    exit 1
}
if (-not (Test-Command pyinstaller)) {
    Write-Host "[错误] 未找到 pyinstaller。请先安装："
    Write-Host ""
    Write-Host "       pip install pyinstaller"
    Write-Host ""
    exit 1
}

Write-Host "[1/3] 环境检查"
$pyVer = python --version 2>&1
$piVer = pyinstaller --version 2>&1
Write-Host "  Python      : $pyVer"
Write-Host "  PyInstaller : $piVer"
Write-Host ""

Write-Host "[2/3] 清理旧产物..."
$startTauriDir = Join-Path $PROJECT_ROOT "start-tauri"
$buildLauncherDir = Join-Path $PROJECT_ROOT "build-launcher"

# 如果旧产物中的 start-tauri.exe 仍在运行，DLL 会被占用导致无法删除
$running = Get-Process -Name "start-tauri" -ErrorAction SilentlyContinue
if ($running) {
    Write-Host "      检测到 start-tauri.exe 正在运行，正在结束进程..."
    $running | Stop-Process -Force
    Start-Sleep -Seconds 1
}

function Remove-DirectoryWithRetry {
    param([string]$Path, [int]$Retries = 5)
    for ($i = 1; $i -le $Retries; $i++) {
        if (-not (Test-Path $Path)) { return $true }
        try {
            Remove-Item -Recurse -Force $Path -ErrorAction Stop
            return $true
        } catch {
            if ($i -eq $Retries) { return $false }
            Write-Host "      无法清理 $Path，可能被占用，2秒后重试 ($i/$Retries)..."
            Start-Sleep -Seconds 2
        }
    }
    return $false
}

$ok1 = Remove-DirectoryWithRetry $startTauriDir
$ok2 = Remove-DirectoryWithRetry $buildLauncherDir
if (-not $ok1 -or -not $ok2) {
    Write-Host ""
    Write-Host "[错误] 无法清理旧产物，请手动关闭占用 'start-tauri' 或 'build-launcher' 的程序后重试。"
    exit 1
}
Write-Host '      已清理 start-tauri\ 与 build-launcher\'
Write-Host ""

Write-Host "[3/3] 开始打包（onedir 模式，耗时约 1-3 分钟）..."
$specPath = Join-Path $TOOLS_DIR "start-tauri.spec"
& pyinstaller --clean --noconfirm --distpath . --workpath build-launcher $specPath
if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "[错误] 打包失败，请查看上方输出。"
    exit 1
}

Write-Host ""
Write-Host "=========================================================="
Write-Host "  打包完成"
Write-Host "  产物: $startTauriDir\start-tauri.exe"
Write-Host "=========================================================="
Write-Host ""
