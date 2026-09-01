[CmdletBinding()]
param()
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$TOOLS_DIR = Split-Path -Parent $PSScriptRoot
$PROJECT_ROOT = Split-Path -Parent $TOOLS_DIR
Set-Location $PROJECT_ROOT
$env:LAUNCHER_NAME = "start-tauri-standalone"

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

Write-Host "=========================================================="
Write-Host "  Comfy APP - 重新打包 start-tauri-standalone.exe（独立模式）"
Write-Host "=========================================================="
Write-Host "  项目根目录: $PROJECT_ROOT"
Write-Host "  入口名    : $env:LAUNCHER_NAME（双击即走 standalone，不连 dev server）"
Write-Host ""

Write-Host "[1/3] 环境检查"
python --version
pyinstaller --version
Write-Host ""

Write-Host "[2/3] 清理旧产物..."
$startTauriDir = Join-Path $PROJECT_ROOT "start-tauri-standalone"
$buildLauncherDir = Join-Path $PROJECT_ROOT "build-launcher-standalone"
if (Test-Path $startTauriDir) { Remove-Item -Recurse -Force $startTauriDir }
if (Test-Path $buildLauncherDir) { Remove-Item -Recurse -Force $buildLauncherDir }
Write-Host '      已清理 start-tauri-standalone\ 与 build-launcher-standalone\'
Write-Host ""

Write-Host "[3/3] 开始打包（onedir 模式，耗时约 1-3 分钟）..."
$specPath = Join-Path $TOOLS_DIR "start-tauri.spec"
& pyinstaller --clean --noconfirm --distpath . --workpath build-launcher-standalone $specPath
if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "[错误] 打包失败，请查看上方输出。"
    exit 1
}

Write-Host ""
Write-Host "=========================================================="
Write-Host "  打包完成"
Write-Host "  产物: $startTauriDir\start-tauri-standalone.exe"
Write-Host ""
Write-Host "  双击即用：走 standalone 模式（独立运行，不连 dev server）。"
Write-Host "  注意：需先运行 tools\build-standalone.bat 构建独立壳，否则会提示先构建。"
Write-Host "=========================================================="
Write-Host ""
