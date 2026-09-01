[CmdletBinding()]
param()
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$TOOLS_DIR = Split-Path -Parent $PSScriptRoot
$PROJECT_ROOT = Split-Path -Parent $TOOLS_DIR
Set-Location $PROJECT_ROOT
. "$PSScriptRoot\Log-Common.ps1"
Initialize-Log "build-launcher-dev.log"
$env:LAUNCHER_NAME = "start-tauri-dev"

function Test-Command {
    param([string]$Name)
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

if (-not (Test-Command python)) {
    Log "[错误] 未找到 python，请先安装 Python 3.10+ 并加入 PATH。"
    exit 1
}
if (-not (Test-Command pyinstaller)) {
    Log "[错误] 未找到 pyinstaller。请先安装："
    Log ""
    Log "       pip install pyinstaller"
    Log ""
    exit 1
}

Log "=========================================================="
Log "  Comfy APP - 重新打包 start-tauri-dev.exe（开发模式）"
Log "=========================================================="
Log "  项目根目录: $PROJECT_ROOT"
Log "  入口名    : $env:LAUNCHER_NAME（双击即走 tauri dev，Rust 热重载）"
Log ""

Log "[1/3] 环境检查"
$pyVer = python --version 2>&1
$piVer = pyinstaller --version 2>&1
Log "  Python      : $pyVer"
Log "  PyInstaller : $piVer"
Log ""

Log "[2/3] 清理旧产物..."
$startTauriDir = Join-Path $PROJECT_ROOT "start-tauri-dev"
$buildLauncherDir = Join-Path $PROJECT_ROOT "build-launcher-dev"
if (Test-Path $startTauriDir) {
    try {
        Remove-Item -Recurse -Force $startTauriDir -ErrorAction Stop
    } catch {
        Log ""
        Log "[错误] 无法清理 start-tauri-dev，可能被其他程序占用（如 start-tauri-dev.exe 仍在运行）。"
        Log "        请手动关闭占用程序后重试。"
        exit 1
    }
}
if (Test-Path $buildLauncherDir) {
    try {
        Remove-Item -Recurse -Force $buildLauncherDir -ErrorAction Stop
    } catch {
        Log ""
        Log "[错误] 无法清理 build-launcher-dev，可能被其他程序占用。"
        Log "        请手动关闭占用程序后重试。"
        exit 1
    }
}
Log '      已清理 start-tauri-dev\ 与 build-launcher-dev\'
Log ""

Log "[3/3] 开始打包（onedir 模式，耗时约 1-3 分钟）..."
$specPath = Join-Path $TOOLS_DIR "start-tauri.spec"
Invoke-Logged "pyinstaller --clean --noconfirm --distpath . --workpath build-launcher-dev $specPath"
if ($LASTEXITCODE -ne 0) {
    Log ""
    Log "[错误] 打包失败，请查看上方输出。"
    exit 1
}

Log ""
Log "=========================================================="
Log "  打包完成"
Log "  产物: $startTauriDir\start-tauri-dev.exe"
Log ""
Log "  双击即用：走 tauri dev（Rust 热重载），无需 --tauri-dev 参数。"
Log "  若要改回默认行为，重新运行 tools\build-launcher.bat 生成 start-tauri.exe。"
Log "=========================================================="
Log ""
