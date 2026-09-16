[CmdletBinding()]
param()
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$TOOLS_DIR = Split-Path -Parent $PSScriptRoot
$PROJECT_ROOT = Split-Path -Parent $TOOLS_DIR
Set-Location $PROJECT_ROOT
. "$PSScriptRoot\Log-Common.ps1"
. "$PSScriptRoot\Build-Guard.ps1"
Initialize-Log "build-launcher-standalone.log"
$env:LAUNCHER_NAME = "start-tauri-standalone"

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
Log "  Comfy APP - 重新打包 start-tauri-standalone.exe（独立模式）"
Log "=========================================================="
Log "  项目根目录: $PROJECT_ROOT"
Log "  入口名    : $env:LAUNCHER_NAME（双击即走 standalone，不连 dev server）"
Log ""

Log "[1/4] 环境检查"
$pyVer = python --version 2>&1
$piVer = pyinstaller --version 2>&1
Log "  Python      : $pyVer"
Log "  PyInstaller : $piVer"
Log ""

Log "[2/4] 前置检查：启动器自身是否仍在运行"
# 产物目录（start-tauri\ 等）里被运行中的启动器占住的 _internal\*.dll 删不掉，
# 旧实现只把这个根因写成一句「可能被其他程序占用」——用户关掉的是桌面壳，
# 启动器自己还在跑，照提示去关窗口永远清理不掉。见 Build-Guard.ps1 的说明。
if ((Assert-LauncherNotRunning -ProjectRoot $PROJECT_ROOT -Purpose "打包启动器") -ne 0) {
    exit 1
}
Log "  未发现正在运行的启动器，继续。"
Log ""

Log "[3/4] 清理旧产物..."
$startTauriDir = Join-Path $PROJECT_ROOT "start-tauri-standalone"
$buildLauncherDir = Join-Path $PROJECT_ROOT "build-launcher-standalone"
if (Test-Path $startTauriDir) {
    try {
        Remove-Item -Recurse -Force $startTauriDir -ErrorAction Stop
    } catch {
        Log ""
        Log "[错误] 无法清理 start-tauri-standalone：目录里的文件被其他程序占用。"
        Log "        最常见的是本仓库启动器 start-tauri-standalone.exe 仍在运行（关掉它的启动画面才会退出）。"
        Log "        自查：Get-Process start-tauri-standalone -ErrorAction SilentlyContinue"
        Log "        结束：taskkill /IM start-tauri-standalone.exe /T /F"
        Log "        若确认没有同名进程，则是权限问题（提权残留的 pyinstaller / 杀毒软件），重启后重试。"
        exit 1
    }
}
if (Test-Path $buildLauncherDir) {
    try {
        Remove-Item -Recurse -Force $buildLauncherDir -ErrorAction Stop
    } catch {
        Log ""
        Log "[错误] 无法清理 build-launcher-standalone，可能被其他程序占用。"
        Log "        请手动关闭占用程序后重试。"
        exit 1
    }
}
Log '      已清理 start-tauri-standalone\ 与 build-launcher-standalone\'
Log ""

Log "[4/4] 开始打包（onedir 模式，耗时约 1-3 分钟）..."
$specPath = Join-Path $TOOLS_DIR "start-tauri.spec"
Invoke-Logged "pyinstaller --clean --noconfirm --distpath . --workpath build-launcher-standalone $specPath"
if ($LASTEXITCODE -ne 0) {
    Log ""
    Log "[错误] 打包失败，请查看上方输出。"
    exit 1
}

Log ""
Log "=========================================================="
Log "  打包完成"
Log "  产物: $startTauriDir\start-tauri-standalone.exe"
Log ""
Log "  双击即用：走 standalone 模式（独立运行，不连 dev server）。"
Log "  注意：需先运行 tools\build\build-standalone.ps1 构建独立壳，否则会提示先构建。"
Log "=========================================================="
Log ""
