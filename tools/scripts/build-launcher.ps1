[CmdletBinding()]
param()
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$TOOLS_DIR = Split-Path -Parent $PSScriptRoot
$PROJECT_ROOT = Split-Path -Parent $TOOLS_DIR
Set-Location $PROJECT_ROOT

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
python --version
pyinstaller --version
Write-Host ""

Write-Host "[2/3] 清理旧产物..."
$startTauriDir = Join-Path $PROJECT_ROOT "start-tauri"
$buildLauncherDir = Join-Path $PROJECT_ROOT "build-launcher"
if (Test-Path $startTauriDir) { Remove-Item -Recurse -Force $startTauriDir }
if (Test-Path $buildLauncherDir) { Remove-Item -Recurse -Force $buildLauncherDir }
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
